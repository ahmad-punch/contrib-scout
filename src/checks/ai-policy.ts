import type { GitHubClient } from "../github.ts";
import type {
  AiPolicy,
  AiStance,
  Evidence,
  Gate,
  GateKind,
  PolicyFile,
  RepoRef,
} from "../types.ts";

/** Files read for policy text, in the order evidence is preferred. */
export const POLICY_FILES = [
  "AI_POLICY.md",
  ".github/AI_POLICY.md",
  "docs/AI_POLICY.md",
  "CONTRIBUTING.md",
  ".github/CONTRIBUTING.md",
  "docs/CONTRIBUTING.md",
  "AGENTS.md",
  ".github/AGENTS.md",
  "docs/AGENTS.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
] as const;

const MAX_EVIDENCE = 2;
const MAX_EVIDENCE_CHARS = 240;

/** Mentions of AI tooling. "AI" itself is matched case-sensitively to skip words like "said". */
const AI_TERM =
  /\b(?:AI|AIs|A\.I\.|LLMs?|GenAI)\b|\b(?:artificial intelligence|chatgpt|gpt-?\d|copilot|claude|gemini|language models?|generative|machine[- ]generated|coding (?:agents?|assistants?)|assisted-by|generated-by|vibe[- ]cod\w*)\b/i;

const BAN =
  /\b(?:forbidden|prohibit\w*|not (?:be )?accept\w*|(?:do not|don't|won't|will not|cannot|can't) accept|will (?:be )?rejected|will not be (?:accepted|merged|reviewed)|no AI|declin\w*|not (?:allowed|permitted)|bann?ed|ban)\b/i;

/** Phrases that look like a ban but negate it, e.g. "AI tools are not forbidden". */
const BAN_NEGATED = /\bnot (?:forbidden|prohibited|banned)\b|\bno ban\b/i;

const DISCLOSE =
  /\b(?:disclos\w*|assisted-by|generated-by|must (?:state|mention|note|indicate)|label\w*|indicate (?:whether|if|that|how)|let (?:us|reviewers|maintainers) know)\b/i;

const SOFTENER =
  /\b(?:encourag\w*|appreciat\w*|recommend\w*|optional\w*|feel free|if you(?:'d| would) like|you may|consider|would be (?:nice|helpful)|welcome to|nice to have|ideally|preferably|we'd love)\b/i;

const GATE_PATTERNS: ReadonlyArray<{ kind: GateKind; pattern: RegExp }> = [
  {
    kind: "assignment",
    pattern:
      /\b(?:must be assigned|be assigned (?:to you )?before|assign(?:ed)? (?:it|the issue|this issue) to you|ask (?:a maintainer )?to be assigned|wait (?:until|to be) assigned|only (?:work on|pick up) (?:issues )?(?:that are )?assigned)\b/i,
  },
  {
    kind: "prior-approval",
    pattern:
      /\b(?:prior approval|pre-?approv\w*|approved issue|(?:must|needs? to) be approved (?:by a maintainer )?before|without (?:prior )?(?:maintainer )?approval)\b/i,
  },
  {
    kind: "ready-label",
    pattern:
      /\b(?:ready[- ]for[- ](?:dev|work)|triage\/accepted|accepted label|status: ?accepted)\b/i,
  },
  { kind: "vouch", pattern: /\bvouch(?:ed|es|ing)?\b/i },
  {
    kind: "linked-issue",
    pattern:
      /\b(?:linked issue (?:is )?required|requires? an? linked issue|must (?:be )?(?:linked|link|referenced|reference) (?:to )?an? (?:existing |open )?issue|without an? (?:linked|associated|existing|approved) issue|open an issue (?:first|before)|issue (?:must|should) (?:exist|be opened) (?:first|before))\b/i,
  },
];

/** Turns a markdown document into plain sentences, one entry per sentence, heading or list item. */
export function extractSentences(markdown: string): string[] {
  const cleaned = markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "\n")
    .replace(/<!--|-->/g, "\n\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/(\*\*|__|`)/g, "");

  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) blocks.push(current.join(" "));
    current = [];
  };

  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(heading[1] ?? "");
      continue;
    }
    const listItem = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem || line.startsWith("|")) flush();
    current.push(listItem ? (listItem[1] ?? "") : line);
  }
  flush();

  return blocks
    .flatMap((block) => block.split(/(?<=[.!?])\s+(?=["'(*_A-Z0-9])/))
    .map((sentence) =>
      sentence
        .replace(/\s+/g, " ")
        .replace(/^[|>\s]+|[|\s]+$/g, "")
        .trim(),
    )
    .filter((sentence) => sentence.length >= 3);
}

interface Match {
  file: string;
  sentence: string;
}

function toEvidence(matches: Match[]): Evidence[] {
  const seen = new Set<string>();
  const evidence: Evidence[] = [];
  for (const match of matches) {
    if (seen.has(match.sentence)) continue;
    seen.add(match.sentence);
    evidence.push({ file: match.file, text: clip(match.sentence) });
    if (evidence.length === MAX_EVIDENCE) break;
  }
  return evidence;
}

function clip(text: string): string {
  return text.length > MAX_EVIDENCE_CHARS ? `${text.slice(0, MAX_EVIDENCE_CHARS - 3)}...` : text;
}

export function isBanSentence(sentence: string): boolean {
  return BAN.test(sentence) && !BAN_NEGATED.test(sentence);
}

/** Classify the AI-contribution stance from the policy files that exist in a repo. */
export function classifyAiStance(files: PolicyFile[]): { stance: AiStance; evidence: Evidence[] } {
  if (files.length === 0) return { stance: "unknown", evidence: [] };

  const aiSentences: Match[] = files.flatMap((file) =>
    extractSentences(file.text)
      .filter((sentence) => AI_TERM.test(sentence))
      .map((sentence) => ({ file: file.path, sentence })),
  );

  const bans = aiSentences.filter((m) => isBanSentence(m.sentence));
  if (bans.length > 0) return { stance: "ban", evidence: toEvidence(bans) };

  const disclosures = aiSentences.filter((m) => DISCLOSE.test(m.sentence));
  const required = disclosures.filter((m) => !SOFTENER.test(m.sentence));
  if (required.length > 0) {
    return { stance: "disclose-required", evidence: toEvidence(required) };
  }
  if (disclosures.length > 0) {
    return { stance: "disclose-encouraged", evidence: toEvidence(disclosures) };
  }
  return { stance: "neutral", evidence: toEvidence(aiSentences) };
}

/** Find contribution gates: steps an outsider must clear before a PR will be considered. */
export function detectGates(files: PolicyFile[]): Gate[] {
  const gates: Gate[] = [];
  for (const { kind, pattern } of GATE_PATTERNS) {
    const hit = findFirst(files, pattern);
    if (hit) gates.push({ kind, evidence: { file: hit.file, text: clip(hit.sentence) } });
  }
  return gates;
}

function findFirst(files: PolicyFile[], pattern: RegExp): Match | null {
  for (const file of files) {
    const sentence = extractSentences(file.text).find((s) => pattern.test(s));
    if (sentence) return { file: file.path, sentence };
  }
  return null;
}

export function analyzePolicyFiles(files: PolicyFile[]): AiPolicy {
  const { stance, evidence } = classifyAiStance(files);
  return {
    stance,
    evidence,
    filesFound: files.map((f) => f.path),
    gates: detectGates(files),
  };
}

type BlobResult = { text: string | null } | null;

export function buildPolicyFilesQuery(): string {
  const fields = POLICY_FILES.map(
    (path, i) =>
      `f${i}: object(expression: ${JSON.stringify(`HEAD:${path}`)}) { ... on Blob { text } }`,
  );
  return `query PolicyFiles($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    ${fields.join("\n    ")}
  }
}`;
}

export async function fetchPolicyFiles(client: GitHubClient, repo: RepoRef): Promise<PolicyFile[]> {
  const data = await client.graphql<{ repository: Record<string, BlobResult> | null }>(
    buildPolicyFilesQuery(),
    { owner: repo.owner, name: repo.name },
  );
  const blobs = data.repository ?? {};
  return POLICY_FILES.flatMap((path, i) => {
    const text = blobs[`f${i}`]?.text;
    return text ? [{ path, text }] : [];
  });
}
