import { describe, expect, it } from "vitest";
import {
  analyzeMerges,
  buildPriorMergesQuery,
  fetchMergeHistory,
  firstMergeByAuthor,
  isBot,
  median,
  PRIOR_MERGES_BATCH,
  splitAuthors,
} from "../src/checks/merges.ts";
import { type FetchLike, GitHubClient, RateLimitError } from "../src/github.ts";
import { fakeGitHub, json, NOW, pr } from "./helpers.ts";

const repo = { owner: "acme", name: "widget" };

describe("median", () => {
  it("handles empty, odd and even inputs", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("isBot", () => {
  it("recognises GitHub Apps and bot-style logins", () => {
    expect(isBot({ __typename: "Bot", login: "renovate" })).toBe(true);
    expect(isBot({ __typename: "User", login: "dependabot-preview" })).toBe(true);
    expect(isBot({ __typename: "User", login: "my-ci-bot" })).toBe(true);
    expect(isBot({ __typename: "User", login: "robotics-fan" })).toBe(false);
  });
});

describe("analyzeMerges", () => {
  it("counts only human fork PRs as outsider merges", () => {
    const stats = analyzeMerges(
      [
        pr(1, { login: "alice", hours: 2 }),
        pr(2, { login: "alice", hours: 6 }),
        pr(3, { login: "bob", hours: 10, daysAgo: 90 }),
        pr(4, { fork: false, login: "maintainer" }),
        pr(5, { login: "dependabot[bot]", bot: true }),
      ],
      NOW,
    );
    expect(stats).toEqual({
      sampleSize: 5,
      forkPrs: 3,
      forkShare: 0.6,
      botPrs: 1,
      medianHoursToMerge: 6,
      distinctForkAuthors: 2,
      forkMergedLast60Days: 2,
      firstTimeForkAuthors: null,
      returningForkAuthors: null,
    });
  });

  it("reports no median when there are no fork PRs", () => {
    const stats = analyzeMerges([pr(1, { fork: false })], NOW);
    expect(stats.forkShare).toBe(0);
    expect(stats.medianHoursToMerge).toBeNull();
  });

  it("splits fork authors into first-time and returning", () => {
    const prs = [pr(1, { login: "alice" }), pr(2, { login: "bob" }), pr(3, { login: "carol" })];
    const prior = new Map([
      ["alice", 0],
      ["bob", 4],
      ["carol", 0],
    ]);
    const stats = analyzeMerges(prs, NOW, prior);
    expect(stats.firstTimeForkAuthors).toBe(2);
    expect(stats.returningForkAuthors).toBe(1);
  });
});

describe("firstMergeByAuthor", () => {
  it("keeps each human fork author's earliest merge, ignoring case, bots and maintainers", () => {
    const first = firstMergeByAuthor([
      pr(1, { login: "Zed", daysAgo: 1 }),
      pr(2, { login: "zed", daysAgo: 9 }),
      pr(3, { login: "amy", daysAgo: 3 }),
      pr(4, { fork: false, login: "maintainer" }),
      pr(5, { login: "renovate[bot]", bot: true }),
    ]);
    expect(first).toEqual([
      { login: "amy", mergedAt: "2026-09-28T00:00:00.000Z" },
      { login: "zed", mergedAt: "2026-09-22T00:00:00.000Z" },
    ]);
  });
});

describe("splitAuthors", () => {
  it("returns null when the lookup did not run and skips authors it has no count for", () => {
    const prs = [pr(1, { login: "alice" }), pr(2, { login: "bob" })];
    expect(splitAuthors(prs, null)).toBeNull();
    expect(splitAuthors(prs, new Map([["alice", 0]]))).toEqual({ firstTime: 1, returning: 0 });
  });
});

describe("buildPriorMergesQuery", () => {
  it("searches merged PRs by each author before their first merge in the sample", () => {
    const query = buildPriorMergesQuery(repo, [
      { login: "alice", mergedAt: "2026-09-01T10:00:00Z" },
    ]);
    expect(query).toContain("query PriorMerges");
    expect(query).toContain(
      'a0: search(query: "repo:acme/widget is:pr is:merged author:alice merged:<2026-09-01T10:00:00Z", type: ISSUE, first: 0) { issueCount }',
    );
  });
});

describe("fetchMergeHistory", () => {
  it("looks up prior merges for every fork author in batches", async () => {
    const prs = Array.from({ length: PRIOR_MERGES_BATCH + 2 }, (_, i) =>
      pr(i + 1, { login: `dev${i}` }),
    );
    const fetch = fakeGitHub({ prs, priorMerges: { dev0: 2, dev26: 1 } });
    const history = await fetchMergeHistory(new GitHubClient({ token: "t", fetch }), repo);
    expect(fetch.calls).toEqual([
      "POST MergedPullRequests",
      "POST PriorMerges",
      "POST PriorMerges",
    ]);
    const stats = analyzeMerges(history.prs, NOW, history.priorMerges);
    expect(stats.firstTimeForkAuthors).toBe(PRIOR_MERGES_BATCH);
    expect(stats.returningForkAuthors).toBe(2);
  });

  it("skips the search when there are no fork authors", async () => {
    const fetch = fakeGitHub({ prs: [pr(1, { fork: false })] });
    const history = await fetchMergeHistory(new GitHubClient({ token: "t", fetch }), repo);
    expect(fetch.calls).toEqual(["POST MergedPullRequests"]);
    expect(history.priorMerges).toEqual(new Map());
  });

  it("keeps the report when the search fails but not when the rate limit is hit", async () => {
    const base = fakeGitHub({ prs: [pr(1, { login: "alice" })] });
    const failWith =
      (response: () => Response): FetchLike =>
      async (url, init) =>
        String(init?.body).includes("PriorMerges") ? response() : base(url, init);

    const broken = new GitHubClient({ token: "t", fetch: failWith(() => json({}, 502)) });
    await expect(fetchMergeHistory(broken, repo)).resolves.toMatchObject({ priorMerges: null });

    const limited = new GitHubClient({
      token: "t",
      fetch: failWith(() => json({}, 403, { "x-ratelimit-remaining": "0" })),
    });
    await expect(fetchMergeHistory(limited, repo)).rejects.toBeInstanceOf(RateLimitError);
  });
});
