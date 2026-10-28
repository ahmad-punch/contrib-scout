# Contributing

Thanks for helping. Bug reports, false positives in the AI-policy detection and new gate
phrasings are all useful.

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. `pnpm install`, then make your change with a test. Tests use a mocked `fetch` and must not
   call the network; add fixture text to the relevant test file instead.
3. Run `pnpm lint && pnpm test && pnpm build` and make sure all three pass.
4. Keep commits small with imperative messages, and update `CHANGELOG.md` under an
   `Unreleased` heading.

When reporting a misclassified repo, include the repo name, the label you got, the label you
expected and the sentence from its docs that should have decided it.
