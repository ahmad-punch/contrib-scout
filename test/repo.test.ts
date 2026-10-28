import { describe, expect, it } from "vitest";
import { parseRepo } from "../src/repo.ts";

describe("parseRepo", () => {
  it.each([
    ["nestjs/nest", "nestjs", "nest"],
    ["https://github.com/honojs/hono", "honojs", "hono"],
    ["github.com/vitejs/vite/pulls", "vitejs", "vite"],
    ["git@github.com:vuejs/core.git", "vuejs", "core"],
  ])("parses %s", (input, owner, name) => {
    expect(parseRepo(input)).toEqual({ owner, name });
  });

  it("rejects input that is not owner/repo", () => {
    expect(() => parseRepo("nest")).toThrow(/owner\/repo/);
    expect(() => parseRepo("bad owner/x")).toThrow(/owner\/repo/);
  });
});
