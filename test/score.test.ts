import { describe, expect, it } from "vitest";
import { toPrPolicy } from "../src/checks/pr-policy.ts";
import { buildVerdict, scoreBreakdown, speedFactor, totalScore } from "../src/score.ts";
import type { AiPolicy, MergeStats } from "../src/types.ts";
import { repoResponse } from "./helpers.ts";

const busy: MergeStats = {
  sampleSize: 100,
  forkPrs: 60,
  forkShare: 0.6,
  botPrs: 5,
  medianHoursToMerge: 12,
  distinctForkAuthors: 30,
  forkMergedLast60Days: 25,
};

const neutral: AiPolicy = { stance: "neutral", evidence: [], filesFound: [], gates: [] };

describe("speedFactor", () => {
  it("is 1 within a day, 0 at a month and in between otherwise", () => {
    expect(speedFactor(5)).toBe(1);
    expect(speedFactor(30 * 24)).toBe(0);
    expect(speedFactor(null)).toBe(0);
    const week = speedFactor(7 * 24);
    expect(week).toBeGreaterThan(0.3);
    expect(week).toBeLessThan(0.7);
  });
});

describe("scoring", () => {
  it("gives a busy, open repo the full 100", () => {
    const pr = toPrPolicy(repoResponse());
    expect(totalScore(pr, scoreBreakdown(busy, neutral))).toBe(100);
  });

  it("subtracts for an AI ban and gates", () => {
    const ai: AiPolicy = {
      ...neutral,
      stance: "ban",
      gates: [{ kind: "assignment", evidence: { file: "CONTRIBUTING.md", text: "x" } }],
    };
    const breakdown = scoreBreakdown(busy, ai);
    expect(breakdown.aiPolicy).toBe(0);
    expect(breakdown.gates).toBe(6);
    expect(totalScore(toPrPolicy(repoResponse()), breakdown)).toBe(86);
  });

  it("scores 0 and blocks when PRs are limited to collaborators", () => {
    const pr = toPrPolicy(repoResponse({ pull_request_creation_policy: "collaborators_only" }));
    expect(pr.externalPrsAllowed).toBe(false);
    expect(totalScore(pr, scoreBreakdown(busy, neutral))).toBe(0);
    expect(buildVerdict(pr, busy, neutral, 0)).toEqual({
      level: "blocked",
      summary:
        "Blocked: pull requests are limited to collaborators (collaborators_only). Open an issue instead.",
    });
  });

  it("blocks archived repos and points to forks", () => {
    const pr = toPrPolicy(repoResponse({ archived: true }));
    expect(buildVerdict(pr, busy, neutral, 0).summary).toMatch(/archived.*active fork/);
  });

  it("adds AI and gate advice to the verdict", () => {
    const ai: AiPolicy = { ...neutral, stance: "disclose-required" };
    const verdict = buildVerdict(toPrPolicy(repoResponse()), busy, ai, 93);
    expect(verdict.summary).toBe(
      "Open: 60% outsider merges, median 12 hours. Disclose AI use in PR body.",
    );
  });
});
