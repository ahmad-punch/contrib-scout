import type { GitHubClient } from "../github.ts";
import type { PrPolicy, RepoRef } from "../types.ts";

export interface RepoResponse {
  full_name: string;
  html_url: string;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  stargazers_count: number;
  default_branch: string;
  has_pull_requests?: boolean;
  pull_request_creation_policy?: string | null;
}

/** Policy values under which anyone with read access may open a pull request. */
const OPEN_POLICIES = new Set(["all", "everyone", "anyone"]);

export function toPrPolicy(repo: RepoResponse): PrPolicy {
  const creationPolicy = repo.pull_request_creation_policy ?? null;
  const pullRequestsEnabled = repo.has_pull_requests !== false;
  const policyAllowsOutsiders = creationPolicy === null || OPEN_POLICIES.has(creationPolicy);
  return {
    creationPolicy,
    externalPrsAllowed:
      policyAllowsOutsiders && pullRequestsEnabled && !repo.archived && !repo.disabled,
    pullRequestsEnabled,
    archived: repo.archived,
    disabled: repo.disabled,
    isFork: repo.fork,
    stars: repo.stargazers_count,
    defaultBranch: repo.default_branch,
    htmlUrl: repo.html_url,
  };
}

export async function fetchRepo(client: GitHubClient, repo: RepoRef): Promise<RepoResponse> {
  return client.rest<RepoResponse>(
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`,
  );
}
