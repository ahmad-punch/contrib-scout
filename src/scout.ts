import { analyzePolicyFiles, fetchPolicyFiles } from "./checks/ai-policy.ts";
import { analyzeIssues, fetchStarterIssues } from "./checks/issues.ts";
import { analyzeMerges, fetchMergedPullRequests } from "./checks/merges.ts";
import { fetchRepo, toPrPolicy } from "./checks/pr-policy.ts";
import { type GitHubClient, NotFoundError } from "./github.ts";
import { repoSlug } from "./repo.ts";
import { buildVerdict, scoreBreakdown, totalScore } from "./score.ts";
import type { RepoRef, Report } from "./types.ts";

export interface ScoutOptions {
  includeIssues: boolean;
  now?: Date;
}

export async function scoutRepo(
  client: GitHubClient,
  repo: RepoRef,
  options: ScoutOptions,
): Promise<Report> {
  const now = options.now ?? new Date();
  const slug = repoSlug(repo);

  const repoData = await fetchRepo(client, repo).catch((error: unknown) => {
    if (error instanceof NotFoundError) {
      throw new NotFoundError(
        `Repository ${slug} was not found. Check the spelling, or use a token that can see it if it is private.`,
      );
    }
    throw error;
  });
  // Use the canonical owner/name so renamed or differently-cased input still matches.
  const [owner = repo.owner, name = repo.name] = repoData.full_name.split("/");
  const canonical: RepoRef = { owner, name };

  const [files, prs, starter] = await Promise.all([
    fetchPolicyFiles(client, canonical),
    fetchMergedPullRequests(client, canonical),
    options.includeIssues ? fetchStarterIssues(client, canonical) : Promise.resolve(null),
  ]);

  const prPolicy = toPrPolicy(repoData);
  const aiPolicy = analyzePolicyFiles(files);
  const merges = analyzeMerges(prs, now);
  const breakdown = scoreBreakdown(merges, aiPolicy);
  const score = totalScore(prPolicy, breakdown);

  return {
    repo: repoData.full_name,
    url: repoData.html_url,
    generatedAt: now.toISOString(),
    prPolicy,
    aiPolicy,
    merges,
    issues: starter ? analyzeIssues(starter.issues, starter.labels, repoData.full_name) : null,
    score,
    breakdown,
    verdict: buildVerdict(prPolicy, merges, aiPolicy, score),
  };
}
