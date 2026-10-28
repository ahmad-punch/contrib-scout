import pc from "picocolors";
import type { Report } from "../types.ts";
import { describeGates, describeLevel, describeMedian, freeIssues } from "./describe.ts";
import { markdownTable, textTable } from "./table.ts";
import { levelColor } from "./text.ts";

const HEADER = [
  "Repo",
  "Score",
  "Verdict",
  "PR policy",
  "AI policy",
  "Gates",
  "Outsider %",
  "Median merge",
  "Fork PRs 60d",
  "Free starter issues",
];

export function sortByScore(reports: Report[]): Report[] {
  return [...reports].sort((a, b) => b.score - a.score || a.repo.localeCompare(b.repo));
}

function cells(report: Report): string[] {
  return [
    report.repo,
    String(report.score),
    describeLevel(report),
    report.prPolicy.creationPolicy ?? "n/a",
    report.aiPolicy.stance,
    describeGates(report),
    `${Math.round(report.merges.forkShare * 100)}%`,
    describeMedian(report),
    String(report.merges.forkMergedLast60Days),
    freeIssues(report.issues),
  ];
}

export function renderCompareText(reports: Report[]): string {
  const sorted = sortByScore(reports);
  const rows = sorted.map((report) => {
    const row = cells(report);
    const color = levelColor(report.verdict.level);
    row[1] = color(row[1] ?? "");
    row[2] = color(row[2] ?? "");
    return row;
  });
  const verdicts = sorted.map((r) => `${pc.bold(r.repo)}: ${r.verdict.summary}`);
  return [textTable([HEADER.map((h) => pc.bold(h)), ...rows]), "", ...verdicts].join("\n");
}

export function renderCompareMarkdown(reports: Report[]): string {
  const sorted = sortByScore(reports);
  const rows = sorted.map((report) => {
    const row = cells(report);
    row[0] = `[${report.repo}](${report.url})`;
    return row;
  });
  const verdicts = sorted.map((r) => `- **${r.repo}**: ${r.verdict.summary}`);
  return [markdownTable([HEADER, ...rows]), "", ...verdicts].join("\n");
}
