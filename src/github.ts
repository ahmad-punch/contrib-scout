export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GitHubClientOptions {
  token: string;
  fetch?: FetchLike;
  apiUrl?: string;
}

export class GitHubError extends Error {
  override name = "GitHubError";
}

export class NotFoundError extends GitHubError {
  override name = "NotFoundError";
}

export class AuthError extends GitHubError {
  override name = "AuthError";
}

export class RateLimitError extends GitHubError {
  override name = "RateLimitError";
  readonly resetAt: Date | null;

  constructor(message: string, resetAt: Date | null) {
    super(message);
    this.resetAt = resetAt;
  }
}

interface GraphQLErrorEntry {
  type?: string;
  message: string;
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: GraphQLErrorEntry[];
}

const USER_AGENT = "contrib-scout";

export class GitHubClient {
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly apiUrl: string;

  constructor(options: GitHubClientOptions) {
    this.token = options.token;
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  }

  async rest<T>(path: string): Promise<T> {
    const response = await this.send(`${this.apiUrl}${path}`, { method: "GET" });
    if (response.status === 404) {
      throw new NotFoundError(`GitHub returned 404 for ${path}`);
    }
    await this.assertOk(response);
    return (await response.json()) as T;
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await this.send(`${this.apiUrl}/graphql`, {
      method: "POST",
      body: JSON.stringify({ query, variables }),
    });
    await this.assertOk(response);
    const payload = (await response.json()) as GraphQLResponse<T>;
    if (payload.errors && payload.errors.length > 0) {
      throw graphqlError(payload.errors, response);
    }
    if (!payload.data) {
      throw new GitHubError("GitHub GraphQL returned no data.");
    }
    return payload.data;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": USER_AGENT,
      "x-github-api-version": "2022-11-28",
      authorization: `Bearer ${this.token}`,
    };
    if (init.body) headers["content-type"] = "application/json";
    try {
      return await this.fetchImpl(url, { ...init, headers });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new GitHubError(
        `Could not reach ${new URL(url).host} (${reason}). Check your network connection or proxy settings.`,
      );
    }
  }

  private async assertOk(response: Response): Promise<void> {
    if (response.ok) return;
    if (isRateLimited(response)) {
      throw rateLimitError(response);
    }
    if (response.status === 401) {
      throw new AuthError(
        "GitHub rejected the token (401). Pass a valid --token, set GITHUB_TOKEN, or run `gh auth login`.",
      );
    }
    const body = await response.text().catch(() => "");
    throw new GitHubError(
      `GitHub API error ${response.status} ${response.statusText}${body ? `: ${truncate(body, 200)}` : ""}`,
    );
  }
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  return (
    response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")
  );
}

function resetTime(response: Response): Date | null {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return new Date(Date.now() + Number(retryAfter) * 1000);
  }
  const reset = response.headers.get("x-ratelimit-reset");
  if (reset && /^\d+$/.test(reset)) {
    return new Date(Number(reset) * 1000);
  }
  return null;
}

function rateLimitError(response: Response): RateLimitError {
  const resetAt = resetTime(response);
  return new RateLimitError(rateLimitMessage(resetAt), resetAt);
}

export function rateLimitMessage(resetAt: Date | null, now: Date = new Date()): string {
  const base = "GitHub API rate limit reached.";
  if (!resetAt) {
    return `${base} Wait a few minutes and try again.`;
  }
  const minutes = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 60_000));
  const clock = resetAt.toISOString().slice(11, 16);
  return `${base} It resets at ${clock} UTC (in about ${minutes} min). Try again then, or use a different token.`;
}

function graphqlError(errors: GraphQLErrorEntry[], response: Response): GitHubError {
  const first = errors[0] as GraphQLErrorEntry;
  if (errors.some((e) => e.type === "RATE_LIMITED")) {
    const resetAt = resetTime(response);
    return new RateLimitError(rateLimitMessage(resetAt), resetAt);
  }
  if (first.type === "NOT_FOUND") {
    return new NotFoundError(first.message);
  }
  return new GitHubError(`GitHub GraphQL error: ${first.message}`);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
