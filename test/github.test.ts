import { describe, expect, it } from "vitest";
import { AuthError, GitHubClient, RateLimitError, rateLimitMessage } from "../src/github.ts";
import { json } from "./helpers.ts";

const client = (response: Response) =>
  new GitHubClient({ token: "t", fetch: async () => response });

describe("GitHubClient", () => {
  it("sends the token and returns REST data", async () => {
    let auth: string | undefined;
    const c = new GitHubClient({
      token: "secret",
      fetch: async (_url, init) => {
        auth = (init?.headers as Record<string, string> | undefined)?.authorization;
        return json({ ok: 1 });
      },
    });
    await expect(c.rest("/repos/a/b")).resolves.toEqual({ ok: 1 });
    expect(auth).toBe("Bearer secret");
  });

  it("turns 401 into an actionable AuthError", async () => {
    await expect(client(json({}, 401)).rest("/x")).rejects.toBeInstanceOf(AuthError);
  });

  it("detects REST and GraphQL rate limits", async () => {
    const limited = json({}, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1" });
    await expect(client(limited).rest("/x")).rejects.toBeInstanceOf(RateLimitError);
    const gql = json({ errors: [{ type: "RATE_LIMITED", message: "slow down" }] });
    await expect(client(gql).graphql("query {}", {})).rejects.toBeInstanceOf(RateLimitError);
  });

  it("explains when the rate limit resets", () => {
    const now = new Date("2026-01-01T10:00:00Z");
    expect(rateLimitMessage(new Date("2026-01-01T10:14:30Z"), now)).toContain(
      "resets at 10:14 UTC (in about 15 min)",
    );
  });
});
