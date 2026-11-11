import { AuthError, type GitHubClient, GitHubError, RateLimitError } from "../github.ts";
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
/** Search fields per PriorMerges query. Larger batches start to time out on GitHub's side. */
export const PRIOR_MERGES_BATCH = 25;

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

/** Merged PRs opened from a fork by a human account. */
function humanForkPrs(prs: MergedPullRequest[]): MergedPullRequest[] {
  return prs.filter((pr) => pr.mergedAt !== null && pr.isCrossRepository && !isBot(pr.author));
}

/** A fork author and the time of their earliest merged PR in the sample. */
export interface FirstMerge {
  login: string;
  mergedAt: string;
}

/** The earliest merged fork PR in the sample for each human author, sorted by login. */
export function firstMergeByAuthor(prs: MergedPullRequest[]): FirstMerge[] {
  const earliest = new Map<string, FirstMerge>();
  for (const pr of humanForkPrs(prs)) {
    if (!pr.author) continue;
    const key = pr.author.login.toLowerCase();
    const mergedAt = pr.mergedAt as string;
    const seen = earliest.get(key);
    if (!seen || Date.parse(mergedAt) < Date.parse(seen.mergedAt)) {
      earliest.set(key, { login: pr.author.login, mergedAt });
    }
  }
  return [...earliest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, first]) => first);
}

/**
 * Split fork authors into first-time contributors (no merged PR in the repo before their
 * earliest one in the sample) and returning authors. `priorMerges` maps lowercased logins to
 * that earlier count; null means the lookup did not run.
 */
export function splitAuthors(
  prs: MergedPullRequest[],
  priorMerges: ReadonlyMap<string, number> | null,
): { firstTime: number; returning: number } | null {
  if (!priorMerges) return null;
  let firstTime = 0;
  let returning = 0;
  for (const author of firstMergeByAuthor(prs)) {
    const prior = priorMerges.get(author.login.toLowerCase());
    if (prior === 0) firstTime++;
    else if (prior !== undefined) returning++;
  }
  return { firstTime, returning };
}

/** Summarise how often, how fast and how recently fork PRs from humans get merged. */
export function analyzeMerges(
  prs: MergedPullRequest[],
  now: Date,
  priorMerges: ReadonlyMap<string, number> | null = null,
): MergeStats {
  const merged = prs.filter((pr) => pr.mergedAt !== null);
  const botPrs = merged.filter((pr) => isBot(pr.author)).length;
  const forkPrs = humanForkPrs(prs);

  const hoursToMerge = forkPrs.map(
    (pr) => (Date.parse(pr.mergedAt as string) - Date.parse(pr.createdAt)) / HOUR_MS,
  );
  const cutoff = now.getTime() - RECENT_WINDOW_DAYS * 24 * HOUR_MS;
  const authors = new Set(forkPrs.map((pr) => (pr.author?.login ?? "ghost").toLowerCase()));
  const split = splitAuthors(prs, priorMerges);

  return {
    sampleSize: merged.length,
    forkPrs: forkPrs.length,
    forkShare: merged.length === 0 ? 0 : forkPrs.length / merged.length,
    botPrs,
    medianHoursToMerge: median(hoursToMerge),
    distinctForkAuthors: authors.size,
    forkMergedLast60Days: forkPrs.filter((pr) => Date.parse(pr.mergedAt as string) >= cutoff)
      .length,
    firstTimeForkAuthors: split?.firstTime ?? null,
    returningForkAuthors: split?.returning ?? null,
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

/** One aliased search per author, counting their merged PRs before the first one in the sample. */
export function buildPriorMergesQuery(repo: RepoRef, authors: FirstMerge[]): string {
  const fields = authors.map((author, i) => {
    const search = `repo:${repo.owner}/${repo.name} is:pr is:merged author:${author.login} merged:<${author.mergedAt}`;
    return `a${i}: search(query: ${JSON.stringify(search)}, type: ISSUE, first: 0) { issueCount }`;
  });
  return `query PriorMerges {\n  ${fields.join("\n  ")}\n}`;
}

/** Map each author's lowercased login to the number of PRs they had merged before the sample. */
export async function fetchPriorMergeCounts(
  client: GitHubClient,
  repo: RepoRef,
  authors: FirstMerge[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  // Batches run one after another to stay clear of GitHub's secondary limits on search.
  for (let start = 0; start < authors.length; start += PRIOR_MERGES_BATCH) {
    const batch = authors.slice(start, start + PRIOR_MERGES_BATCH);
    const data = await client.graphql<Record<string, { issueCount: number } | null>>(
      buildPriorMergesQuery(repo, batch),
      {},
    );
    batch.forEach((author, i) => {
      const hit = data[`a${i}`];
      if (hit) counts.set(author.login.toLowerCase(), hit.issueCount);
    });
  }
  return counts;
}

export interface MergeHistory {
  prs: MergedPullRequest[];
  /** Null when the first-time contributor lookup failed. */
  priorMerges: Map<string, number> | null;
}

export async function fetchMergeHistory(
  client: GitHubClient,
  repo: RepoRef,
): Promise<MergeHistory> {
  const prs = await fetchMergedPullRequests(client, repo);
  const priorMerges = await fetchPriorMergeCounts(client, repo, firstMergeByAuthor(prs)).catch(
    (error: unknown) => {
      // The first-timer split is detail on top of the score, so a failed search should not
      // sink the whole report. Rate limits and bad tokens still stop the run.
      const recoverable =
        error instanceof GitHubError &&
        !(error instanceof RateLimitError) &&
        !(error instanceof AuthError);
      if (!recoverable) throw error;
      return null;
    },
  );
  return { prs, priorMerges };
}
