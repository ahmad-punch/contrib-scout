import { expect } from "vitest";
import type { MergedPullRequest } from "../src/checks/merges.ts";
import type { RepoResponse } from "../src/checks/pr-policy.ts";
import type { FetchLike } from "../src/github.ts";

export const NOW = new Date("2026-10-01T00:00:00Z");

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function repoResponse(overrides: Partial<RepoResponse> = {}): RepoResponse {
  return {
    full_name: "acme/widget",
    html_url: "https://github.com/acme/widget",
    archived: false,
    disabled: false,
    fork: false,
    stargazers_count: 1200,
    default_branch: "main",
    has_pull_requests: true,
    pull_request_creation_policy: "all",
    ...overrides,
  };
}

export function pr(
  number: number,
  options: { fork?: boolean; login?: string; bot?: boolean; hours?: number; daysAgo?: number } = {},
): MergedPullRequest {
  const merged = new Date(NOW.getTime() - (options.daysAgo ?? 5) * 86_400_000);
  const created = new Date(merged.getTime() - (options.hours ?? 10) * 3_600_000);
  return {
    number,
    isCrossRepository: options.fork ?? true,
    createdAt: created.toISOString(),
    mergedAt: merged.toISOString(),
    author: { __typename: options.bot ? "Bot" : "User", login: options.login ?? `user${number}` },
  };
}

export interface FakeGitHub {
  repo?: RepoResponse | null;
  files?: Record<string, string>;
  prs?: MergedPullRequest[];
  labels?: string[];
  issues?: unknown;
  /** Merged PRs each login had before the sample. Logins not listed have none. */
  priorMerges?: Record<string, number>;
}

/** A fetch stand-in that answers the REST and GraphQL calls contrib-scout makes. */
export function fakeGitHub(fake: FakeGitHub): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const handler = async (url: string, init?: RequestInit): Promise<Response> => {
    if (!url.endsWith("/graphql")) {
      calls.push(`GET ${new URL(url).pathname}`);
      return fake.repo === null
        ? json({ message: "Not Found" }, 404)
        : json(fake.repo ?? repoResponse());
    }
    const { query, variables } = JSON.parse(String(init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    const name = /query (\w+)/.exec(query)?.[1] ?? "unknown";
    calls.push(`POST ${name}`);
    switch (name) {
      case "PolicyFiles":
        return json({ data: { repository: policyBlobs(query, fake.files ?? {}) } });
      case "MergedPullRequests":
        return json({ data: { repository: { pullRequests: { nodes: fake.prs ?? [] } } } });
      case "StarterLabels": {
        const nodes = (fake.labels ?? []).map((label) => ({ name: label }));
        return json({ data: { repository: { first: { nodes }, help: { nodes: [] } } } });
      }
      case "PriorMerges":
        return json({ data: priorMergeCounts(query, fake.priorMerges ?? {}) });
      case "StarterIssues":
        expect(variables.first).toBe(20);
        return json({ data: { repository: { issues: fake.issues } } });
      default:
        throw new Error(`unexpected query ${name}`);
    }
  };
  return Object.assign(handler, { calls });
}

function policyBlobs(query: string, files: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const match of query.matchAll(/(f\d+): object\(expression: "HEAD:([^"]+)"\)/g)) {
    const [, alias = "", path = ""] = match;
    result[alias] = path in files ? { text: files[path] } : null;
  }
  return result;
}

function priorMergeCounts(query: string, counts: Record<string, number>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const match of query.matchAll(/(a\d+): search\(query: "[^"]*author:(\S+) /g)) {
    const [, alias = "", login = ""] = match;
    result[alias] = { issueCount: counts[login] ?? 0 };
  }
  return result;
}
