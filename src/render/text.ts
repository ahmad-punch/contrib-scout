import pc from "picocolors";
import type { AiStance, Report, VerdictLevel } from "../types.ts";
import {
  describeBreakdown,
  describeGate,
  describeIssues,
  describeMedian,
  describeOutsiderShare,
  describePrPolicy,
  describeStance,
  describeStatus,
} from "./describe.ts";

const LABEL_WIDTH = 18;
const MAX_FREE_ISSUES = 3;

export function levelColor(level: VerdictLevel): (text: string) => string {
  switch (level) {
    case "open":
      return pc.green;
    case "worth-a-try":
      return pc.yellow;
    default:
      return pc.red;
  }
}

function stanceColor(stance: AiStance): (text: string) => string {
  if (stance === "ban") return pc.red;
  if (stance.startsWith("disclose")) return pc.yellow;
  return (text) => text;
}

function row(label: string, value: string): string {
  return `${pc.dim(label.padEnd(LABEL_WIDTH))}${value}`;
}

function detail(value: string): string {
  return `${" ".repeat(LABEL_WIDTH)}${value}`;
}

function quote(file: string, text: string): string {
  return detail(pc.dim(`"${text}" (${file})`));
}

export function renderText(report: Report): string {
  const color = levelColor(report.verdict.level);
  const { aiPolicy, merges, issues } = report;
  const lines: string[] = [
    `${pc.bold(report.repo)}  ${pc.dim(report.url)}`,
    `${color(pc.bold(`Score ${report.score}/100`))}  ${report.verdict.summary}`,
    "",
    row(
      "PR policy",
      report.prPolicy.externalPrsAllowed
        ? describePrPolicy(report)
        : pc.red(describePrPolicy(report)),
    ),
    row("Repo status", describeStatus(report)),
    row("AI policy", stanceColor(aiPolicy.stance)(describeStance(aiPolicy.stance))),
  ];

  for (const evidence of aiPolicy.evidence) lines.push(quote(evidence.file, evidence.text));
  if (aiPolicy.filesFound.length > 0) {
    lines.push(detail(pc.dim(`read: ${aiPolicy.filesFound.join(", ")}`)));
  }

  if (aiPolicy.gates.length === 0) {
    lines.push(row("Gates", "none detected"));
  } else {
    aiPolicy.gates.forEach((gate, i) => {
      const label = i === 0 ? "Gates" : "";
      lines.push(row(label, pc.yellow(describeGate(gate.kind))));
      lines.push(quote(gate.evidence.file, gate.evidence.text));
    });
  }

  lines.push(row("Outsider merges", describeOutsiderShare(report)));
  if (merges.forkPrs > 0) {
    lines.push(
      detail(
        `median ${describeMedian(report)} to merge, ${merges.distinctForkAuthors} distinct authors, ${merges.forkMergedLast60Days} merged in the last 60 days`,
      ),
    );
  }
  if (merges.botPrs > 0) lines.push(detail(pc.dim(`${merges.botPrs} bot PRs excluded`)));

  lines.push(row("Starter issues", describeIssues(issues)));
  const free = issues?.issues.filter((issue) => !issue.taken).slice(0, MAX_FREE_ISSUES) ?? [];
  for (const issue of free) lines.push(detail(`free: #${issue.number} ${issue.title}`));

  lines.push(row("Score breakdown", pc.dim(describeBreakdown(report))));
  return lines.join("\n");
}
