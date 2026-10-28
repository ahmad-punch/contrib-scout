import type { Report } from "../types.ts";
import {
  describeBreakdown,
  describeGates,
  describeIssues,
  describeMedian,
  describeOutsiderShare,
  describePrPolicy,
  describeStance,
  describeStatus,
} from "./describe.ts";
import { markdownTable } from "./table.ts";

function evidenceCell(report: Report): string {
  const quotes = [
    ...report.aiPolicy.evidence,
    ...report.aiPolicy.gates.map((gate) => gate.evidence),
  ].map((e) => `"${e.text}" (${e.file})`);
  return quotes.length > 0 ? quotes.join("<br>") : "none";
}

export function renderMarkdown(report: Report): string {
  const { merges } = report;
  const rows = [
    ["Check", "Result"],
    ["PR policy", describePrPolicy(report)],
    ["Repo status", describeStatus(report)],
    ["AI policy", describeStance(report.aiPolicy.stance)],
    ["Gates", describeGates(report)],
    ["Evidence", evidenceCell(report)],
    ["Outsider merges", describeOutsiderShare(report)],
    ["Median time to merge (fork PRs)", describeMedian(report)],
    ["Distinct fork authors", String(merges.distinctForkAuthors)],
    ["Fork PRs merged, last 60 days", String(merges.forkMergedLast60Days)],
    ["Starter issues", describeIssues(report.issues)],
    ["Score breakdown", describeBreakdown(report)],
  ];
  return [
    `### [${report.repo}](${report.url}): ${report.score}/100`,
    "",
    `**${report.verdict.summary}**`,
    "",
    markdownTable(rows),
  ].join("\n");
}
