# contrib-scout

Should I open a PR here? A one-command scorecard for any GitHub repo before you spend a weekend on a contribution.

[![CI](https://github.com/ahmad-punch/contrib-scout/actions/workflows/ci.yml/badge.svg)](https://github.com/ahmad-punch/contrib-scout/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](package.json)

## Demo

Real output, captured on 2026-11-11:

```console
$ contrib-scout nestjs/nest
nestjs/nest  https://github.com/nestjs/nest
Score 96/100  Open: 46% outsider merges, median 10.6 hours.

PR policy         all (anyone can open PRs)
Repo status       active
AI policy         neutral (no AI rules found)
                  read: CONTRIBUTING.md, .github/PULL_REQUEST_TEMPLATE.md
Gates             none detected
Outsider merges   46% (46 of last 100 merged PRs came from forks)
                  median 10.6 hours to merge, 13 distinct authors, 46 merged in the last 60 days
                  authors: 6 first-time, 7 returning (6 of 46 fork PRs were the author's first merge here)
                  43 bot PRs excluded
Starter issues    none open (good first issue 👍, type: help wanted :slightly_smiling_face:)
Score breakdown   outsider share 36.8/40, merge speed 15/15, recent activity 15/15, author diversity 8.7/10, AI policy 10/10, gates 10/10
```

```console
$ contrib-scout honojs/hono
honojs/hono  https://github.com/honojs/hono
Score 0/100  Blocked: pull requests are limited to collaborators (collaborators_only). Open an issue instead.

PR policy         collaborators_only (outsiders blocked)
Repo status       active
AI policy         neutral (no AI rules found)
                  "AI Usage Policy" (docs/CONTRIBUTING.md)
                  "You may use AI to contribute, but it must never waste a maintainer's time or make their work unpleasant." (docs/CONTRIBUTING.md)
                  read: docs/CONTRIBUTING.md, .github/pull_request_template.md
Gates             none detected
Outsider merges   39% (39 of last 100 merged PRs came from forks)
                  median 25.1 days to merge, 33 distinct authors, 37 merged in the last 60 days
                  authors: 22 first-time, 11 returning (22 of 39 fork PRs were the author's first merge here)
Starter issues    none open (help wanted)
Score breakdown   outsider share 31.2/40, merge speed 0.8/15, recent activity 15/15, author diversity 10/10, AI policy 10/10, gates 10/10
```

Hono still merged 37 fork PRs in the last 60 days, more than half of them from first-time
contributors, but its repository now reports `pull_request_creation_policy: collaborators_only`,
so a new outsider PR cannot be opened at all. That is exactly the kind of thing you want to know
before writing code.

Compare several repos at once:

```console
$ contrib-scout nestjs/nest honojs/hono
Repo         Score  Verdict  PR policy           AI policy  Gates          Outsider %  Median merge  Fork PRs 60d  Free starter issues
nestjs/nest  96     Open     all                 neutral    none detected  46%         10.6 hours    46            0/0
honojs/hono  0      Blocked  collaborators_only  neutral    none detected  39%         25.1 days     37            0/0

nestjs/nest: Open: 46% outsider merges, median 10.6 hours.
honojs/hono: Blocked: pull requests are limited to collaborators (collaborators_only). Open an issue instead.
```

## Why

Choosing where to contribute is mostly guesswork. A repo can look welcoming and still
block outside PRs, quietly require you to be assigned first, ban AI-assisted code, or
take a month to merge anything from a fork. All of that is discoverable from the GitHub
API and a few markdown files, so contrib-scout reads them and gives you one number and
one sentence of advice.

## Install

Requires Node 20 or newer and a GitHub token (any token works, no scopes needed).

```sh
git clone https://github.com/ahmad-punch/contrib-scout.git
cd contrib-scout
pnpm install
pnpm build
node dist/cli.js nestjs/nest
```

To put `contrib-scout` on your PATH, run `pnpm link --global` from the repo.

The token is read from, in order: `--token`, `GITHUB_TOKEN`, `GH_TOKEN`, then `gh auth token`.
If you use the GitHub CLI and are logged in, there is nothing to configure.

## Usage

```text
contrib-scout <repos...> [options]

  <repos...>        owner/repo or a GitHub URL; pass several to get a comparison table
  --json            print the full report as JSON
  --markdown        print a markdown table to paste into an issue or notes
  --no-issues       skip the good-first-issue check (fewer API calls)
  --token <token>   GitHub token
  --cache-ttl <h>   reuse cached GitHub responses for this many hours (default 6)
  --no-cache        always call the GitHub API and leave the cache untouched
  --no-color        disable coloured output
```

Exit codes: `0` success, `1` a repo could not be scouted (not found, auth, rate limit), `2` bad arguments.

## How it works

Each repo costs one REST call and four GraphQL queries (two with `--no-issues`), plus one
search query per 25 distinct fork authors for the first-time contributor split. On a repeat run
within the cache TTL it costs nothing.

1. **PR policy.** `GET /repos/{owner}/{repo}` gives `pull_request_creation_policy`, `archived`
   and `disabled`. If outsiders cannot open PRs, the score is 0 and the verdict is `Blocked`.
2. **AI policy.** One GraphQL query fetches `AI_POLICY.md`, `CONTRIBUTING.md`, `AGENTS.md` and the
   PR template from the root, `.github/` and `docs/`. Sentences that mention AI tooling are
   classified as `ban`, `disclose-required`, `disclose-encouraged` or `neutral` (`unknown` when no
   files exist), and the matching sentences are printed as evidence. The same text is scanned for
   gates: assignment required, prior approval, ready-for-work labels, vouching and issue-first rules.
3. **Outsider merge rate.** The last 100 merged PRs, using `isCrossRepository` to find fork PRs.
   Bots (GitHub Apps, `[bot]`, `-bot`, dependabot, renovate) are excluded from the outsider count.
   Reports share of fork PRs, median hours from open to merge, distinct fork authors and fork
   merges in the last 60 days.
   Fork authors are then split into first-time and returning contributors. GitHub reports
   `authorAssociation` as of query time, so every merged author already reads `CONTRIBUTOR` and
   the field cannot tell them apart. Instead, one GraphQL query with an aliased
   `search(query: "repo:... is:pr is:merged author:... merged:<...")` per author counts their
   merged PRs from before their earliest merge in the sample (about 1 rate-limit point per 25
   authors). Zero means a first-time contributor. If that search fails, the split shows as
   unavailable and the rest of the report is unaffected. The split is shown for context and does
   not change the score.
4. **Starter issue health.** Finds `good first issue` and `help wanted` labels (including variants
   like `type: help wanted`), then checks up to 20 open issues for linked open or merged PRs via
   cross-referenced timeline events, and for assignees. An issue with either is counted as taken.

### Score (0 to 100)

| Component | Points | Full points when |
| --- | --- | --- |
| Outsider share | 40 | at least 50% of recent merged PRs came from human forks (linear below) |
| Merge speed | 15 | median fork PR merges within 24 hours; 0 at 30 days, log-scaled between |
| Recent activity | 15 | 10 or more fork PRs merged in the last 60 days (linear below) |
| Author diversity | 10 | 15 or more distinct fork authors (linear below) |
| AI policy | 10 | neutral/unknown 10, disclose-encouraged 9, disclose-required 7, ban 0 |
| Gates | 10 | minus 4 per detected gate, floor 0 |

The total is rounded and forced to 0 when the repo is archived, disabled, has PRs turned off, or
limits PR creation to collaborators. Verdicts: `Open` at 70 or more, `Worth a try` at 40 to 69,
`Long shot` below 40, `Blocked` when PRs cannot be opened.

### Cache

Successful responses are cached on disk for 6 hours (`--cache-ttl` to change, `--no-cache` to
bypass), so scoring a long list a second time, or adding one repo to a comparison, only spends
rate limit on what is new. Each entry is a JSON file named by a SHA-256 of the token and the
request, so neither ends up on disk in clear text, and errors are never cached. The cache lives in
`$CONTRIB_SCOUT_CACHE_DIR` if set, otherwise `$XDG_CACHE_HOME/contrib-scout`,
`~/Library/Caches/contrib-scout` on macOS, `%LOCALAPPDATA%\contrib-scout\Cache` on Windows or
`~/.cache/contrib-scout` elsewhere. Delete that folder to clear it.

The AI and gate detection is pattern matching over prose, so read the quoted evidence before
trusting the label. See [docs/DESIGN.md](docs/DESIGN.md) for why it works this way.

## Roadmap

- Read `CODEOWNERS` and branch protection to estimate review latency per area.
- Fold the first-time contributor share into the score once it has been checked against more repos.
- Add the first-time/returning split to the multi-repo comparison table behind a `--wide` flag.

## Contributing

Issues and PRs are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
Run `pnpm lint && pnpm test` before opening a PR. Tests never touch the network.

## License

[MIT](LICENSE)
