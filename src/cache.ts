import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_CACHE_TTL_HOURS = 6;

/** Stores decoded GitHub responses. `get` resolves to undefined on a miss. */
export interface ResponseCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface FileCacheOptions {
  dir: string;
  ttlMs: number;
  now?: () => number;
}

interface Entry {
  storedAt: number;
  value: unknown;
}

/**
 * One JSON file per request, named by a SHA-256 of the cache key so neither URLs nor
 * tokens end up in file names. Missing, expired or unreadable entries are misses, and
 * a cache that cannot be written only costs extra API calls.
 */
export class FileCache implements ResponseCache {
  private readonly dir: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: FileCacheOptions) {
    this.dir = options.dir;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  async get(key: string): Promise<unknown> {
    let entry: Partial<Entry> | null;
    try {
      entry = JSON.parse(await readFile(this.path(key), "utf8")) as Partial<Entry> | null;
    } catch {
      return undefined;
    }
    if (typeof entry?.storedAt !== "number") return undefined;
    const age = this.now() - entry.storedAt;
    return age >= 0 && age < this.ttlMs ? entry.value : undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    const file = this.path(key);
    const temp = `${file}.${randomUUID()}.tmp`;
    const entry: Entry = { storedAt: this.now(), value };
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(temp, JSON.stringify(entry));
      await rename(temp, file);
    } catch {
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }

  private path(key: string): string {
    return join(this.dir, `${createHash("sha256").update(key).digest("hex")}.json`);
  }
}

/**
 * CONTRIB_SCOUT_CACHE_DIR wins, then XDG_CACHE_HOME, then the platform's usual
 * per-user cache folder.
 */
export function defaultCacheDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const override = env.CONTRIB_SCOUT_CACHE_DIR?.trim();
  if (override) return override;
  const xdg = env.XDG_CACHE_HOME?.trim();
  if (xdg) return join(xdg, "contrib-scout");
  if (platform === "darwin") return join(home, "Library", "Caches", "contrib-scout");
  const localAppData = env.LOCALAPPDATA?.trim();
  if (platform === "win32" && localAppData) return join(localAppData, "contrib-scout", "Cache");
  return join(home, ".cache", "contrib-scout");
}
