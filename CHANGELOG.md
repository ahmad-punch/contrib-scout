# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-11

### Added

- First-time versus returning fork authors in the outsider merge stats, shown in the text and
  markdown scorecards and as `merges.firstTimeForkAuthors` and `merges.returningForkAuthors` in
  JSON. Found with one aliased GraphQL search query per 25 fork authors.
- On-disk response cache under the per-user cache directory with a 6 hour TTL, so repeat runs
  cost no rate limit. `--cache-ttl <hours>` changes the TTL, `--no-cache` bypasses it and
  `CONTRIB_SCOUT_CACHE_DIR` moves it.

## [0.1.0] - 2026-10-28

### Added

- `contrib-scout owner/repo` scorecard with a 0 to 100 score and a one-line verdict.
- PR creation policy and archived/disabled checks from the REST repo endpoint.
- AI contribution policy stance (`ban`, `disclose-required`, `disclose-encouraged`, `neutral`,
  `unknown`) with quoted evidence, plus gate detection (assignment, prior approval, ready label,
  vouching, issue first).
- Outsider merge rate from the last 100 merged PRs: fork share, median hours to merge, distinct
  fork authors and fork merges in the last 60 days, with bots excluded.
- Good-first-issue and help-wanted health, checking up to 20 issues for linked PRs and assignees.
- `--json`, `--markdown`, `--no-issues` and `--token` flags, and a comparison table for several repos.
- Token lookup from `--token`, `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`.
