import { Command, CommanderError } from "commander";
import { version } from "../package.json";
import { DEFAULT_CACHE_TTL_HOURS, defaultCacheDir, FileCache } from "./cache.ts";
import { AuthError, type FetchLike, GitHubClient, RateLimitError } from "./github.ts";
import { renderCompareMarkdown, renderCompareText, sortByScore } from "./render/compare.ts";
import { renderMarkdown } from "./render/markdown.ts";
import { renderText } from "./render/text.ts";
import { parseRepo, repoSlug } from "./repo.ts";
import { scoutRepo } from "./scout.ts";
import {
  type GhTokenReader,
  MISSING_TOKEN_MESSAGE,
  readGhCliToken,
  resolveToken,
} from "./token.ts";
import type { RepoRef, Report } from "./types.ts";

export interface RunDeps {
  fetch?: FetchLike;
  env?: NodeJS.ProcessEnv;
  readGhToken?: GhTokenReader;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  showProgress?: boolean;
  now?: Date;
}

interface CliOptions {
  json?: boolean;
  markdown?: boolean;
  issues: boolean;
  token?: string;
  cache: boolean;
  cacheTtl?: string;
}

const CONCURRENCY = 3;
const HOUR_MS = 3_600_000;

function buildProgram(): Command {
  return new Command()
    .name("contrib-scout")
    .description(
      "Should I open a PR here? Scores a GitHub repo on PR policy, AI-contribution policy,\noutsider merge rate and good-first-issue health. Pass several repos to compare them.",
    )
    .version(version)
    .argument("<repos...>", "one or more repositories as owner/repo or GitHub URLs")
    .option("--json", "print the full report as JSON")
    .option("--markdown", "print a markdown table you can paste into an issue")
    .option("--no-issues", "skip the good-first-issue check (fewer API calls)")
    .option(
      "--token <token>",
      "GitHub token (default: GITHUB_TOKEN, GH_TOKEN, then `gh auth token`)",
    )
    .option(
      "--cache-ttl <hours>",
      `reuse cached GitHub responses for this many hours (default: ${DEFAULT_CACHE_TTL_HOURS})`,
    )
    .option("--no-cache", "always call the GitHub API and leave the cache untouched")
    .option("--no-color", "disable coloured output")
    .showHelpAfterError("(run contrib-scout --help for usage)")
    .addHelpText(
      "after",
      "\nExamples:\n  contrib-scout nestjs/nest\n  contrib-scout honojs/hono --markdown\n  contrib-scout vitejs/vite vuejs/core sveltejs/svelte --no-issues\n  contrib-scout nestjs/nest --no-cache",
    );
}

/** Hours from --cache-ttl, or null when the value is not a positive number. */
export function parseCacheTtl(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_CACHE_TTL_HOURS;
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function render(reports: Report[], options: CliOptions): string {
  if (options.json) {
    const payload = reports.length === 1 ? reports[0] : sortByScore(reports);
    return JSON.stringify(payload, null, 2);
  }
  if (reports.length === 1) {
    const [report] = reports as [Report];
    return options.markdown ? renderMarkdown(report) : renderText(report);
  }
  return options.markdown ? renderCompareMarkdown(reports) : renderCompareText(reports);
}

/** Fatal errors stop every repo; anything else is reported per repo in compare mode. */
function isFatal(error: unknown): boolean {
  return error instanceof RateLimitError || error instanceof AuthError;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs the CLI and returns the process exit code. */
export async function run(argv: string[], deps: RunDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(`${text}\n`));
  const program = buildProgram()
    .exitOverride()
    .configureOutput({
      writeOut: (text) => stdout(text.trimEnd()),
      writeErr: (text) => stderr(text.trimEnd()),
    });

  try {
    program.parse(argv);
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
    throw error;
  }

  const options = program.opts<CliOptions>();
  if (options.json && options.markdown) {
    stderr("Choose one output format: --json or --markdown, not both.");
    return 2;
  }
  const cacheTtlHours = parseCacheTtl(options.cacheTtl);
  if (cacheTtlHours === null) {
    stderr("--cache-ttl takes a positive number of hours, for example 6 or 0.5.");
    return 2;
  }

  let repos: RepoRef[];
  try {
    repos = program.processedArgs[0].map((input: string) => parseRepo(input));
  } catch (error) {
    stderr(message(error));
    return 2;
  }

  const env = deps.env ?? process.env;
  const resolved = resolveToken(options.token, env, deps.readGhToken ?? readGhCliToken);
  if (!resolved) {
    stderr(MISSING_TOKEN_MESSAGE);
    return 1;
  }

  const cache = options.cache
    ? new FileCache({ dir: defaultCacheDir(env), ttlMs: cacheTtlHours * HOUR_MS })
    : null;
  const client = new GitHubClient({
    token: resolved.token,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(cache ? { cache } : {}),
  });
  const showProgress = deps.showProgress ?? Boolean(process.stderr.isTTY);
  const scoutOptions = { includeIssues: options.issues, ...(deps.now ? { now: deps.now } : {}) };

  const failures: string[] = [];
  let fatal: unknown = null;
  const outcomes = await mapLimit(repos, CONCURRENCY, async (repo) => {
    if (fatal) return null;
    if (showProgress) stderr(`Scouting ${repoSlug(repo)}...`);
    try {
      return await scoutRepo(client, repo, scoutOptions);
    } catch (error) {
      if (isFatal(error)) fatal = error;
      else failures.push(`${repoSlug(repo)}: ${message(error)}`);
      return null;
    }
  });

  if (fatal) {
    stderr(message(fatal));
    return 1;
  }
  const reports = outcomes.filter((report): report is Report => report !== null);
  if (reports.length > 0) stdout(render(reports, options));
  for (const failure of failures) stderr(failure);
  return failures.length > 0 ? 1 : 0;
}
