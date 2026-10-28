import { formatDuration, levelLabel, WEIGHTS } from "../score.ts";
import type { AiStance, GateKind, IssueHealth, Report } from "../types.ts";

/** Plain-language fragments shared by the text, markdown and compare renderers. */

export function describePrPolicy(report: Report): string {
  const { creationPolicy, externalPrsAllowed, pullRequestsEnabled } = report.prPolicy;
  if (!pullRequestsEnabled) return "pull requests disabled";
  const value = creationPolicy ?? "not reported";
  return externalPrsAllowed ? `${value} (anyone can open PRs)` : `${value} (outsiders blocked)`;
}

export function describeStatus(report: Report): string {
  const { archived, disabled, isFork } = report.prPolicy;
  if (archived) return "archived (read-only)";
  if (disabled) return "disabled";
  return isFork ? "active (this repo is itself a fork)" : "active";
}

const STANCE_TEXT: Record<AiStance, string> = {
  ban: "ban (AI-assisted contributions not accepted)",
  "disclose-required": "disclose-required (state AI use in the PR)",
  "disclose-encouraged": "disclose-encouraged",
  neutral: "neutral (no AI rules found)",
  unknown: "unknown (no policy files found)",
};

export function describeStance(stance: AiStance): string {
  return STANCE_TEXT[stance];
}

const GATE_TEXT: Record<GateKind, string> = {
  assignment: "assignment required",
  "prior-approval": "prior approval",
  "ready-label": "ready-for-work label",
  vouch: "vouching",
  "linked-issue": "issue first",
};

export function describeGate(kind: GateKind): string {
  return GATE_TEXT[kind];
}

export function describeGates(report: Report): string {
  const { gates } = report.aiPolicy;
  return gates.length === 0 ? "none detected" : gates.map((g) => describeGate(g.kind)).join(", ");
}

export function describeOutsiderShare(report: Report): string {
  const { forkPrs, sampleSize, forkShare } = report.merges;
  if (sampleSize === 0) return "no merged PRs found";
  return `${Math.round(forkShare * 100)}% (${forkPrs} of last ${sampleSize} merged PRs came from forks)`;
}

export function describeMedian(report: Report): string {
  const { medianHoursToMerge } = report.merges;
  return medianHoursToMerge === null ? "n/a" : formatDuration(medianHoursToMerge);
}

export function describeIssues(issues: IssueHealth | null): string {
  if (!issues) return "skipped (--no-issues)";
  if (issues.labels.length === 0) return "no good-first-issue or help-wanted labels";
  if (issues.totalOpen === 0) return `none open (${issues.labels.join(", ")})`;
  return `${issues.totalOpen} open; ${issues.taken} of ${issues.sampled} checked already taken`;
}

export function freeIssues(issues: IssueHealth | null): string {
  if (!issues) return "-";
  return `${issues.sampled - issues.taken}/${issues.sampled}`;
}

export function describeBreakdown(report: Report): string {
  const b = report.breakdown;
  return [
    `outsider share ${b.outsiderShare}/${WEIGHTS.outsiderShare}`,
    `merge speed ${b.mergeSpeed}/${WEIGHTS.mergeSpeed}`,
    `recent activity ${b.recentActivity}/${WEIGHTS.recentActivity}`,
    `author diversity ${b.authorDiversity}/${WEIGHTS.authorDiversity}`,
    `AI policy ${b.aiPolicy}/${WEIGHTS.aiPolicy}`,
    `gates ${b.gates}/${WEIGHTS.gates}`,
  ].join(", ");
}

export function describeLevel(report: Report): string {
  return levelLabel(report.verdict.level);
}
