import { execFileSync } from "node:child_process";

export type TokenSource = "flag" | "GITHUB_TOKEN" | "GH_TOKEN" | "gh";

export interface ResolvedToken {
  token: string;
  source: TokenSource;
}

export type GhTokenReader = () => string | null;

export function readGhCliToken(): string | null {
  try {
    const output = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a GitHub token in order of precedence: explicit flag, GITHUB_TOKEN,
 * GH_TOKEN, then the GitHub CLI's stored credential.
 */
export function resolveToken(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  readGh: GhTokenReader = readGhCliToken,
): ResolvedToken | null {
  if (flag?.trim()) return { token: flag.trim(), source: "flag" };
  const githubToken = env.GITHUB_TOKEN?.trim();
  if (githubToken) return { token: githubToken, source: "GITHUB_TOKEN" };
  const ghToken = env.GH_TOKEN?.trim();
  if (ghToken) return { token: ghToken, source: "GH_TOKEN" };
  const fromCli = readGh();
  return fromCli ? { token: fromCli, source: "gh" } : null;
}

export const MISSING_TOKEN_MESSAGE = [
  "No GitHub token found. contrib-scout needs one for the GraphQL API.",
  "Fix it with one of:",
  "  gh auth login                      (the token is picked up automatically)",
  "  export GITHUB_TOKEN=<token>        (a classic or fine-grained token, no scopes needed)",
  "  contrib-scout owner/repo --token <token>",
].join("\n");
