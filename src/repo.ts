import type { RepoRef } from "./types.ts";

const NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Accepts `owner/repo`, `github.com/owner/repo`, full https or ssh URLs,
 * with or without a trailing `.git` or extra path segments.
 */
export function parseRepo(input: string): RepoRef {
  let rest = input.trim();
  rest = rest.replace(/^git@github\.com:/i, "");
  rest = rest.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "");
  const [owner, rawName] = rest.split("/");
  const name = rawName?.replace(/\.git$/i, "");
  if (!owner || !name || !NAME.test(owner) || !NAME.test(name)) {
    throw new Error(
      `"${input}" is not a GitHub repository. Use the form owner/repo, for example nestjs/nest.`,
    );
  }
  return { owner, name };
}

export function repoSlug(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}
