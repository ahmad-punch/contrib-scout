import type { GitHubClient } from "../github.ts";
import type { MergeStats, RepoRef } from "../types.ts";

export interface MergedPullRequest {
  number: number;
  isCrossRepository: boolean;
  createdAt: string;
  mergedAt: string | null;
  author: { __typename: string; login: string } | null;
}

const RECENT_WINDOW_DAYS = 60;
const HOUR_MS = 3_600_000;

export const MERGED_PRS_QUERY = `query MergedPullRequests($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number
        isCrossRepository
        createdAt
        mergedAt
        author { __typename login }
      }
    }
  }
}`;

const BOT_LOGIN = /\[bot\]$|-bot$|-robot$|^dependabot|^renovate/i;

export function isBot(author: MergedPullRequest["author"]): boolean {
  if (!author) return false;
  return author.__typename === "Bot" || BOT_LOGIN.test(author.login);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + upper) / 2 : upper;
}

/** Summarise how often, how fast and how recently fork PRs from humans get merged. */
export function analyzeMerges(prs: MergedPullRequest[], now: Date): MergeStats {
  const merged = prs.filter((pr) => pr.mergedAt !== null);
  const botPrs = merged.filter((pr) => isBot(pr.author)).length;
  const forkPrs = merged.filter((pr) => pr.isCrossRepository && !isBot(pr.author));

  const hoursToMerge = forkPrs.map(
    (pr) => (Date.parse(pr.mergedAt as string) - Date.parse(pr.createdAt)) / HOUR_MS,
  );
  const cutoff = now.getTime() - RECENT_WINDOW_DAYS * 24 * HOUR_MS;
  const authors = new Set(forkPrs.map((pr) => (pr.author?.login ?? "ghost").toLowerCase()));

  return {
    sampleSize: merged.length,
    forkPrs: forkPrs.length,
    forkShare: merged.length === 0 ? 0 : forkPrs.length / merged.length,
    botPrs,
    medianHoursToMerge: median(hoursToMerge),
    distinctForkAuthors: authors.size,
    forkMergedLast60Days: forkPrs.filter((pr) => Date.parse(pr.mergedAt as string) >= cutoff)
      .length,
  };
}

export async function fetchMergedPullRequests(
  client: GitHubClient,
  repo: RepoRef,
): Promise<MergedPullRequest[]> {
  const data = await client.graphql<{
    repository: { pullRequests: { nodes: MergedPullRequest[] } } | null;
  }>(MERGED_PRS_QUERY, { owner: repo.owner, name: repo.name });
  return data.repository?.pullRequests.nodes ?? [];
}
