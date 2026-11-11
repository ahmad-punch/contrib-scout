import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultCacheDir, FileCache } from "../src/cache.ts";
import { GitHubClient } from "../src/github.ts";
import { json } from "./helpers.ts";

const HOUR = 3_600_000;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "contrib-scout-cache-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileCache", () => {
  it("returns stored values until the TTL runs out", async () => {
    let now = 1_000_000;
    const cache = new FileCache({ dir, ttlMs: HOUR, now: () => now });
    await cache.set("k", { a: 1 });
    expect(await cache.get("k")).toEqual({ a: 1 });
    now += HOUR - 1;
    expect(await cache.get("k")).toEqual({ a: 1 });
    now += 1;
    expect(await cache.get("k")).toBeUndefined();
  });

  it("names files by hash so keys and tokens never reach the disk", async () => {
    const cache = new FileCache({ dir, ttlMs: HOUR });
    await cache.set("secret-token\nGET https://api.github.com/repos/a/b", 1);
    const [file = ""] = await readdir(dir);
    expect(file).toMatch(/^[0-9a-f]{64}\.json$/);
    expect(await readFile(join(dir, file), "utf8")).not.toContain("secret-token");
  });

  it("treats missing and corrupt entries as misses", async () => {
    const cache = new FileCache({ dir, ttlMs: HOUR });
    expect(await cache.get("missing")).toBeUndefined();
    await cache.set("k", 1);
    const [file = ""] = await readdir(dir);
    await writeFile(join(dir, file), "{not json");
    expect(await cache.get("k")).toBeUndefined();
    await writeFile(join(dir, file), "null");
    expect(await cache.get("k")).toBeUndefined();
  });

  it("ignores a cache directory it cannot create", async () => {
    const blocker = join(dir, "file");
    await writeFile(blocker, "");
    const cache = new FileCache({ dir: join(blocker, "cache"), ttlMs: HOUR });
    await expect(cache.set("k", 1)).resolves.toBeUndefined();
    expect(await cache.get("k")).toBeUndefined();
  });
});

describe("defaultCacheDir", () => {
  it("prefers the override, then XDG_CACHE_HOME, then the platform default", () => {
    expect(defaultCacheDir({ CONTRIB_SCOUT_CACHE_DIR: "/c", XDG_CACHE_HOME: "/x" })).toBe("/c");
    expect(defaultCacheDir({ XDG_CACHE_HOME: "/x" }, "darwin", "/h")).toBe("/x/contrib-scout");
    expect(defaultCacheDir({}, "darwin", "/h")).toBe("/h/Library/Caches/contrib-scout");
    expect(defaultCacheDir({}, "linux", "/h")).toBe("/h/.cache/contrib-scout");
  });
});

describe("GitHubClient with a cache", () => {
  function counting(body: unknown) {
    let calls = 0;
    const fetch = async () => {
      calls++;
      return json(body);
    };
    return { fetch, count: () => calls };
  }

  it("serves repeated REST and GraphQL requests from disk", async () => {
    const cache = new FileCache({ dir, ttlMs: HOUR });
    const rest = counting({ full_name: "acme/widget" });
    const gql = counting({ data: { repository: { id: 1 } } });

    for (let i = 0; i < 2; i++) {
      const c = new GitHubClient({ token: "t", fetch: rest.fetch, cache });
      await expect(c.rest("/repos/acme/widget")).resolves.toEqual({ full_name: "acme/widget" });
      const g = new GitHubClient({ token: "t", fetch: gql.fetch, cache });
      await expect(g.graphql("query Q { x }", { owner: "acme" })).resolves.toEqual({
        repository: { id: 1 },
      });
    }
    expect(rest.count()).toBe(1);
    expect(gql.count()).toBe(1);
  });

  it("keys entries by token and request body", async () => {
    const cache = new FileCache({ dir, ttlMs: HOUR });
    const gql = counting({ data: { ok: true } });
    await new GitHubClient({ token: "a", fetch: gql.fetch, cache }).graphql("query Q { x }", {});
    await new GitHubClient({ token: "b", fetch: gql.fetch, cache }).graphql("query Q { x }", {});
    await new GitHubClient({ token: "a", fetch: gql.fetch, cache }).graphql("query Q { x }", {
      n: 1,
    });
    expect(gql.count()).toBe(3);
  });

  it("does not cache errors", async () => {
    const cache = new FileCache({ dir, ttlMs: HOUR });
    const failing = counting({ errors: [{ message: "boom" }] });
    const c = new GitHubClient({ token: "t", fetch: failing.fetch, cache });
    await expect(c.graphql("query Q { x }", {})).rejects.toThrow("boom");
    await expect(c.graphql("query Q { x }", {})).rejects.toThrow("boom");
    expect(failing.count()).toBe(2);
    expect(await readdir(dir)).toEqual([]);
  });
});
