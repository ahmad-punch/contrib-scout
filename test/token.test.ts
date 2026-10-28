import { describe, expect, it } from "vitest";
import { resolveToken } from "../src/token.ts";

const noGh = () => null;

describe("resolveToken", () => {
  it("prefers the --token flag", () => {
    expect(resolveToken("flag", { GITHUB_TOKEN: "env" }, noGh)).toEqual({
      token: "flag",
      source: "flag",
    });
  });

  it("falls back through GITHUB_TOKEN, GH_TOKEN and gh auth token", () => {
    expect(resolveToken(undefined, { GITHUB_TOKEN: "a", GH_TOKEN: "b" }, noGh)?.source).toBe(
      "GITHUB_TOKEN",
    );
    expect(resolveToken(undefined, { GH_TOKEN: "b" }, noGh)?.source).toBe("GH_TOKEN");
    expect(resolveToken(undefined, {}, () => "cli")).toEqual({ token: "cli", source: "gh" });
  });

  it("returns null when nothing is available", () => {
    expect(resolveToken("  ", { GITHUB_TOKEN: "" }, noGh)).toBeNull();
  });
});
