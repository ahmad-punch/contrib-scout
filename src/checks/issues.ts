import type { GitHubClient } from "../github.ts";
import type { IssueHealth, RepoRef, StarterIssue } from "../types.ts";

export const MAX_ISSUES = 20;

/** Matches "good first issue", "good-first-issue", "help wanted" and decorated variants such as "type: help wanted". */
const STARTER_LABEL = /good[\s_-]*first[\s_-]*issue|help[\s_-]*wanted/i;

export const STARTER_LABELS_QUERY = `query StarterLabels($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    first: labels(first: 50, query: "first") { nodes { name } }
    help: labels(first: 50, query: "help") { nodes { name } }
  }
}`;

interface LabelNodes {
  nodes: Array<{ name: string }>;
}

interface PullRequestRef {
  __typename: string;
  number?: number;
  state?: "OPEN" | "CLOSED" | "MERGED";
  repository?: { nameWithOwner: string };
}

interface TimelineNode {
  __typename: string;
  source?: PullRequestRef;
  subject?: PullRequestRef;
}

export interface RawIssue {
  number: number;
  title: string;
  url: string;
  assignees: { totalCount: number };
  timelineItems: { nodes: Array<TimelineNode | null> };
}

export interface RawIssues {
  totalCount: number;
  nodes: RawIssue[];
}

export const STARTER_ISSUES_QUERY = `query StarterIssues($owner: String!, $name: String!, $labels: [String!], $first: Int!) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, labels: $labels, first: $first, orderBy: { field: CREATED_AT, direction: DESC }) {
      totalCount
      nodes {
        number
        title
        url
        assignees(first: 1) { totalCount }
        timelineItems(itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT], first: 25) {
          nodes {
            __typename
            ... on CrossReferencedEvent {
              source { __typename ... on PullRequest { number state repository { nameWithOwner } } }
            }
            ... on ConnectedEvent {
              subject { __typename ... on PullRequest { number state repository { nameWithOwner } } }
            }
          }
        }
      }
    }
  }
}`;

/**
 * Count distinct pull requests in this repository that reference the issue
 * and are still alive (open or merged). Closed-unmerged attempts do not count.
 */
export function countLinkedPrs(issue: RawIssue, repoSlug: string): number {
  const numbers = new Set<number>();
  for (const node of issue.timelineItems.nodes) {
    const pr = node?.source ?? node?.subject;
    if (pr?.__typename !== "PullRequest" || pr.number === undefined) continue;
    if (pr.repository?.nameWithOwner.toLowerCase() !== repoSlug.toLowerCase()) continue;
    if (pr.state === "CLOSED") continue;
    numbers.add(pr.number);
  }
  return numbers.size;
}

export function pickStarterLabels(names: string[]): string[] {
  return [...new Set(names.filter((name) => STARTER_LABEL.test(name)))].sort();
}

export function analyzeIssues(raw: RawIssues, labels: string[], repoSlug: string): IssueHealth {
  const issues: StarterIssue[] = raw.nodes.map((issue) => {
    const linkedPrs = countLinkedPrs(issue, repoSlug);
    const assigned = issue.assignees.totalCount > 0;
    return {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      linkedPrs,
      assigned,
      taken: linkedPrs > 0 || assigned,
    };
  });
  return {
    labels,
    totalOpen: raw.totalCount,
    sampled: issues.length,
    taken: issues.filter((issue) => issue.taken).length,
    issues,
  };
}

export interface StarterIssuesResult {
  labels: string[];
  issues: RawIssues;
}

async function fetchStarterLabels(client: GitHubClient, repo: RepoRef): Promise<string[]> {
  const data = await client.graphql<{ repository: { first: LabelNodes; help: LabelNodes } | null }>(
    STARTER_LABELS_QUERY,
    { owner: repo.owner, name: repo.name },
  );
  const repository = data.repository;
  if (!repository) return [];
  return pickStarterLabels(
    [...repository.first.nodes, ...repository.help.nodes].map((l) => l.name),
  );
}

export async function fetchStarterIssues(
  client: GitHubClient,
  repo: RepoRef,
): Promise<StarterIssuesResult> {
  const labels = await fetchStarterLabels(client, repo);
  if (labels.length === 0) return { labels, issues: { totalCount: 0, nodes: [] } };
  const data = await client.graphql<{ repository: { issues: RawIssues } | null }>(
    STARTER_ISSUES_QUERY,
    { owner: repo.owner, name: repo.name, labels, first: MAX_ISSUES },
  );
  return { labels, issues: data.repository?.issues ?? { totalCount: 0, nodes: [] } };
}
