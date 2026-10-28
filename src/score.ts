import type {
  AiPolicy,
  AiStance,
  GateKind,
  MergeStats,
  PrPolicy,
  ScoreBreakdown,
  Verdict,
  VerdictLevel,
} from "./types.ts";

/** Maximum points per component. They add up to 100. */
export const WEIGHTS = {
  outsiderShare: 40,
  mergeSpeed: 15,
  recentActivity: 15,
  authorDiversity: 10,
  aiPolicy: 10,
  gates: 10,
} as const;

/** Outsider share at or above this earns full points. */
const FULL_SHARE = 0.5;
/** Merge times at or below FAST_HOURS earn full speed points, SLOW_HOURS or more earn none. */
const FAST_HOURS = 24;
const SLOW_HOURS = 30 * 24;
const FULL_RECENT = 10;
const FULL_AUTHORS = 15;
const GATE_PENALTY = 4;

const AI_POINTS: Record<AiStance, number> = {
  neutral: 10,
  unknown: 10,
  "disclose-encouraged": 9,
  "disclose-required": 7,
  ban: 0,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Log-scaled: each doubling of median merge time costs the same number of points. */
export function speedFactor(medianHours: number | null): number {
  if (medianHours === null) return 0;
  if (medianHours <= FAST_HOURS) return 1;
  return clamp01(1 - Math.log(medianHours / FAST_HOURS) / Math.log(SLOW_HOURS / FAST_HOURS));
}

export function scoreBreakdown(merges: MergeStats, ai: AiPolicy): ScoreBreakdown {
  return {
    outsiderShare: round1(WEIGHTS.outsiderShare * clamp01(merges.forkShare / FULL_SHARE)),
    mergeSpeed: round1(WEIGHTS.mergeSpeed * speedFactor(merges.medianHoursToMerge)),
    recentActivity: round1(
      WEIGHTS.recentActivity * clamp01(merges.forkMergedLast60Days / FULL_RECENT),
    ),
    authorDiversity: round1(
      WEIGHTS.authorDiversity * clamp01(merges.distinctForkAuthors / FULL_AUTHORS),
    ),
    aiPolicy: AI_POINTS[ai.stance],
    gates: Math.max(0, WEIGHTS.gates - GATE_PENALTY * ai.gates.length),
  };
}

export function blockReason(pr: PrPolicy): string | null {
  if (pr.archived) return "the repository is archived";
  if (pr.disabled) return "the repository is disabled";
  if (!pr.pullRequestsEnabled) return "pull requests are turned off";
  if (!pr.externalPrsAllowed) {
    return `pull requests are limited to collaborators (${pr.creationPolicy})`;
  }
  return null;
}

export function totalScore(pr: PrPolicy, breakdown: ScoreBreakdown): number {
  if (blockReason(pr)) return 0;
  const sum = Object.values(breakdown).reduce((acc, points) => acc + points, 0);
  return Math.round(Math.min(100, Math.max(0, sum)));
}

export function levelFor(score: number): Exclude<VerdictLevel, "blocked"> {
  if (score >= 70) return "open";
  if (score >= 40) return "worth-a-try";
  return "long-shot";
}

const LEVEL_LABEL: Record<VerdictLevel, string> = {
  open: "Open",
  "worth-a-try": "Worth a try",
  "long-shot": "Long shot",
  blocked: "Blocked",
};

const AI_ADVICE: Partial<Record<AiStance, string>> = {
  ban: "Do not submit AI-assisted work.",
  "disclose-required": "Disclose AI use in PR body.",
  "disclose-encouraged": "Consider disclosing AI use.",
};

const GATE_ADVICE: Record<GateKind, string> = {
  assignment: "Get assigned to an issue before coding.",
  "prior-approval": "Get maintainer approval first.",
  "linked-issue": "Open or link an issue first.",
  "ready-label": "Pick issues marked ready for work.",
  vouch: "Find a maintainer to vouch for you.",
};

export function formatDuration(hours: number): string {
  if (hours < 24) return `${round1(hours)} hours`;
  return `${round1(hours / 24)} days`;
}

export function levelLabel(level: VerdictLevel): string {
  return LEVEL_LABEL[level];
}

export function buildVerdict(
  pr: PrPolicy,
  merges: MergeStats,
  ai: AiPolicy,
  score: number,
): Verdict {
  const reason = blockReason(pr);
  if (reason) {
    const advice =
      pr.archived || pr.disabled ? "Look for an active fork." : "Open an issue instead.";
    return { level: "blocked", summary: `Blocked: ${reason}. ${advice}` };
  }
  const level = levelFor(score);

  const facts =
    merges.forkPrs === 0
      ? `no outsider merges in the last ${merges.sampleSize} PRs.`
      : `${Math.round(merges.forkShare * 100)}% outsider merges, median ${formatDuration(
          merges.medianHoursToMerge ?? 0,
        )}.`;

  const advice = [AI_ADVICE[ai.stance], ...ai.gates.map((gate) => GATE_ADVICE[gate.kind])]
    .filter((line): line is string => Boolean(line))
    .slice(0, 2);

  return { level, summary: [`${LEVEL_LABEL[level]}: ${facts}`, ...advice].join(" ") };
}
