import { describe, expect, it } from "vitest";
import { analyzeMerges, isBot, median } from "../src/checks/merges.ts";
import { NOW, pr } from "./helpers.ts";

describe("median", () => {
  it("handles empty, odd and even inputs", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("isBot", () => {
  it("recognises GitHub Apps and bot-style logins", () => {
    expect(isBot({ __typename: "Bot", login: "renovate" })).toBe(true);
    expect(isBot({ __typename: "User", login: "dependabot-preview" })).toBe(true);
    expect(isBot({ __typename: "User", login: "my-ci-bot" })).toBe(true);
    expect(isBot({ __typename: "User", login: "robotics-fan" })).toBe(false);
  });
});

describe("analyzeMerges", () => {
  it("counts only human fork PRs as outsider merges", () => {
    const stats = analyzeMerges(
      [
        pr(1, { login: "alice", hours: 2 }),
        pr(2, { login: "alice", hours: 6 }),
        pr(3, { login: "bob", hours: 10, daysAgo: 90 }),
        pr(4, { fork: false, login: "maintainer" }),
        pr(5, { login: "dependabot[bot]", bot: true }),
      ],
      NOW,
    );
    expect(stats).toEqual({
      sampleSize: 5,
      forkPrs: 3,
      forkShare: 0.6,
      botPrs: 1,
      medianHoursToMerge: 6,
      distinctForkAuthors: 2,
      forkMergedLast60Days: 2,
    });
  });

  it("reports no median when there are no fork PRs", () => {
    const stats = analyzeMerges([pr(1, { fork: false })], NOW);
    expect(stats.forkShare).toBe(0);
    expect(stats.medianHoursToMerge).toBeNull();
  });
});
