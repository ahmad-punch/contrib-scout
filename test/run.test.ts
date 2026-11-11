import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCacheTtl, run } from "../src/run.ts";
import type { Report } from "../src/types.ts";
import { fakeGitHub, NOW, pr, repoResponse } from "./helpers.ts";

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "contrib-scout-run-"));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

async function cli(args: string[], fetch = fakeGitHub({})) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(["node", "contrib-scout", ...args], {
    fetch,
    env: { GITHUB_TOKEN: "test-token", NO_COLOR: "1", CONTRIB_SCOUT_CACHE_DIR: cacheDir },
    readGhToken: () => null,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    showProgress: false,
    now: NOW,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const healthy = {
  files: {
    "CONTRIBUTING.md":
      "# Contributing\n\nPlease disclose any AI assistance in your PR description.\n\nYou must be assigned to an issue before you start work.",
  },
  prs: [pr(1, { login: "alice" }), pr(2, { login: "bob" }), pr(3, { fork: false })],
  priorMerges: { bob: 3 },
  labels: ["good first issue"],
  issues: {
    totalCount: 2,
    nodes: [
      {
        number: 7,
        title: "Fix typo in docs",
        url: "https://github.com/acme/widget/issues/7",
        assignees: { totalCount: 0 },
        timelineItems: { nodes: [] },
      },
      {
        number: 8,
        title: "Add option",
        url: "https://github.com/acme/widget/issues/8",
        assignees: { totalCount: 0 },
        timelineItems: {
          nodes: [
            {
              __typename: "CrossReferencedEvent",
              source: {
                __typename: "PullRequest",
                number: 9,
                state: "OPEN",
                repository: { nameWithOwner: "acme/widget" },
              },
            },
          ],
        },
      },
    ],
  },
};

describe("contrib-scout CLI", () => {
  it("prints a scorecard for one repo", async () => {
    const { code, out } = await cli(["acme/widget"], fakeGitHub(healthy));
    expect(code).toBe(0);
    expect(out).toContain("acme/widget");
    expect(out).toContain("disclose-required");
    expect(out).toContain("assignment required");
    expect(out).toContain("67% (2 of last 3 merged PRs came from forks)");
    expect(out).toContain(
      "authors: 1 first-time, 1 returning (1 of 2 fork PRs were the author's first merge here)",
    );
    expect(out).toContain("2 open; 1 of 2 checked already taken");
    expect(out).toContain("free: #7 Fix typo in docs");
  });

  it("emits JSON with the full report", async () => {
    const { out } = await cli(["acme/widget", "--json"], fakeGitHub(healthy));
    const report = JSON.parse(out) as Report;
    expect(report.repo).toBe("acme/widget");
    expect(report.aiPolicy.stance).toBe("disclose-required");
    expect(report.aiPolicy.gates.map((g) => g.kind)).toEqual(["assignment"]);
    expect(report.merges.distinctForkAuthors).toBe(2);
    expect(report.merges.firstTimeForkAuthors).toBe(1);
    expect(report.merges.returningForkAuthors).toBe(1);
    expect(report.issues?.taken).toBe(1);
    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it("skips issue queries with --no-issues", async () => {
    const fetch = fakeGitHub(healthy);
    const { out } = await cli(["acme/widget", "--no-issues", "--markdown"], fetch);
    expect(fetch.calls).not.toContain("POST StarterIssues");
    expect(fetch.calls).not.toContain("POST StarterLabels");
    expect(out).toContain("| Starter issues | skipped (--no-issues) |");
    expect(out).toContain("| First-time vs returning authors | 1 first-time, 1 returning");
  });

  it("renders a comparison table sorted by score", async () => {
    const fetch = fakeGitHub(healthy);
    const { code, out } = await cli(["acme/widget", "acme/widget", "--markdown"], fetch);
    expect(code).toBe(0);
    expect(out).toMatch(/^\| Repo \| Score \| Verdict/);
    expect(out.match(/\[acme\/widget\]/g)).toHaveLength(2);
  });

  it("scores a collaborators-only repo as blocked", async () => {
    const fetch = fakeGitHub({
      ...healthy,
      repo: repoResponse({ pull_request_creation_policy: "collaborators_only" }),
    });
    const { out } = await cli(["acme/widget", "--json"], fetch);
    const report = JSON.parse(out) as Report;
    expect(report.score).toBe(0);
    expect(report.verdict.level).toBe("blocked");
  });

  it("explains a missing repository", async () => {
    const { code, err } = await cli(["acme/missing"], fakeGitHub({ repo: null }));
    expect(code).toBe(1);
    expect(err).toContain("Repository acme/missing was not found");
  });

  it("rejects bad input and conflicting flags with exit code 2", async () => {
    expect((await cli(["not-a-repo"])).code).toBe(2);
    expect((await cli(["a/b", "--json", "--markdown"])).err).toContain("Choose one output format");
  });

  it("answers a repeat run from the cache without calling GitHub", async () => {
    const first = fakeGitHub(healthy);
    const firstRun = await cli(["acme/widget", "--json"], first);
    expect(first.calls.length).toBeGreaterThan(0);

    const second = fakeGitHub(healthy);
    const secondRun = await cli(["acme/widget", "--json"], second);
    expect(second.calls).toEqual([]);
    expect(secondRun.out).toBe(firstRun.out);
  });

  it("neither reads nor writes the cache with --no-cache", async () => {
    await cli(["acme/widget"], fakeGitHub(healthy));
    const fetch = fakeGitHub(healthy);
    await cli(["acme/widget", "--no-cache"], fetch);
    expect(fetch.calls).toContain("GET /repos/acme/widget");

    await rm(cacheDir, { recursive: true, force: true });
    await cli(["acme/widget", "--no-cache"], fakeGitHub(healthy));
    await expect(readdir(cacheDir)).rejects.toThrow();
  });

  it("rejects a cache TTL that is not a positive number", async () => {
    expect(parseCacheTtl(undefined)).toBe(6);
    expect(parseCacheTtl("0.5")).toBe(0.5);
    const { code, err } = await cli(["a/b", "--cache-ttl", "0"]);
    expect(code).toBe(2);
    expect(err).toContain("--cache-ttl takes a positive number of hours");
  });

  it("tells the user how to get a token", async () => {
    const err: string[] = [];
    const code = await run(["node", "contrib-scout", "a/b"], {
      env: {},
      readGhToken: () => null,
      stderr: (text) => err.push(text),
      stdout: () => undefined,
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("gh auth login");
  });
});
