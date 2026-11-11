export interface RepoRef {
  owner: string;
  name: string;
}

export interface PrPolicy {
  /** Raw `pull_request_creation_policy` value, or null when the API omits it. */
  creationPolicy: string | null;
  externalPrsAllowed: boolean;
  pullRequestsEnabled: boolean;
  archived: boolean;
  disabled: boolean;
  isFork: boolean;
  stars: number;
  defaultBranch: string;
  htmlUrl: string;
}

export type AiStance = "ban" | "disclose-required" | "disclose-encouraged" | "neutral" | "unknown";

export interface Evidence {
  file: string;
  text: string;
}

export type GateKind = "assignment" | "prior-approval" | "ready-label" | "vouch" | "linked-issue";

export interface Gate {
  kind: GateKind;
  evidence: Evidence;
}

export interface PolicyFile {
  path: string;
  text: string;
}

export interface AiPolicy {
  stance: AiStance;
  evidence: Evidence[];
  filesFound: string[];
  gates: Gate[];
}

export interface MergeStats {
  /** Merged PRs examined (at most 100). */
  sampleSize: number;
  /** Merged PRs opened from a fork by a human account. */
  forkPrs: number;
  /** forkPrs / sampleSize, 0..1. */
  forkShare: number;
  botPrs: number;
  medianHoursToMerge: number | null;
  distinctForkAuthors: number;
  forkMergedLast60Days: number;
  /**
   * Fork authors whose earliest merged PR in the sample was their first merged PR in the repo.
   * Each one accounts for exactly one first-time fork PR. Null when the lookup failed.
   */
  firstTimeForkAuthors: number | null;
  /** Fork authors who already had a merged PR in the repo before the sample. */
  returningForkAuthors: number | null;
}

export interface StarterIssue {
  number: number;
  title: string;
  url: string;
  linkedPrs: number;
  assigned: boolean;
  taken: boolean;
}

export interface IssueHealth {
  labels: string[];
  totalOpen: number;
  sampled: number;
  taken: number;
  issues: StarterIssue[];
}

export interface ScoreBreakdown {
  outsiderShare: number;
  mergeSpeed: number;
  recentActivity: number;
  authorDiversity: number;
  aiPolicy: number;
  gates: number;
}

export type VerdictLevel = "open" | "worth-a-try" | "long-shot" | "blocked";

export interface Verdict {
  level: VerdictLevel;
  summary: string;
}

export interface Report {
  repo: string;
  url: string;
  generatedAt: string;
  prPolicy: PrPolicy;
  aiPolicy: AiPolicy;
  merges: MergeStats;
  issues: IssueHealth | null;
  score: number;
  breakdown: ScoreBreakdown;
  verdict: Verdict;
}
