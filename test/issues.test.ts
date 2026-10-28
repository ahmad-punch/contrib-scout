import { describe, expect, it } from "vitest";
import {
  analyzeIssues,
  countLinkedPrs,
  pickStarterLabels,
  type RawIssue,
} from "../src/checks/issues.ts";

function issue(number: number, refs: Array<[number, string, string]>, assignees = 0): RawIssue {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/acme/widget/issues/${number}`,
    assignees: { totalCount: assignees },
    timelineItems: {
      nodes: refs.map(([prNumber, state, repo]) => ({
        __typename: "CrossReferencedEvent",
        source: {
          __typename: "PullRequest",
          number: prNumber,
          state: state as "OPEN" | "CLOSED" | "MERGED",
          repository: { nameWithOwner: repo },
        },
      })),
    },
  };
}

describe("pickStarterLabels", () => {
  it("keeps good-first-issue and help-wanted variants only", () => {
    expect(
      pickStarterLabels([
        "good first issue",
        "type: help wanted",
        "first-timers-only",
        "Good-First-Issue",
      ]),
    ).toEqual(["Good-First-Issue", "good first issue", "type: help wanted"]);
  });
});

describe("countLinkedPrs", () => {
  it("counts distinct live PRs from the same repo", () => {
    const raw = issue(1, [
      [10, "OPEN", "acme/widget"],
      [10, "OPEN", "acme/widget"],
      [11, "MERGED", "Acme/Widget"],
      [12, "CLOSED", "acme/widget"],
      [13, "OPEN", "someone/else"],
    ]);
    expect(countLinkedPrs(raw, "acme/widget")).toBe(2);
  });
});

describe("analyzeIssues", () => {
  it("marks issues with linked PRs or assignees as taken", () => {
    const health = analyzeIssues(
      {
        totalCount: 42,
        nodes: [issue(1, [[10, "OPEN", "acme/widget"]]), issue(2, [], 1), issue(3, [])],
      },
      ["good first issue"],
      "acme/widget",
    );
    expect(health.totalOpen).toBe(42);
    expect(health.sampled).toBe(3);
    expect(health.taken).toBe(2);
    expect(health.issues.map((i) => i.taken)).toEqual([true, true, false]);
  });
});
