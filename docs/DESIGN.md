# Design

The main decision in contrib-scout is to classify AI policies and contribution gates with
transparent regular expressions over sentences from the repo's own `CONTRIBUTING.md`,
`AI_POLICY.md`, `AGENTS.md` and PR template, rather than with a language model or a hand-curated
list of repos. Rules are applied in a fixed order (any ban sentence wins, then disclosure without a
softening word, then softened disclosure, otherwise neutral), and every label is printed next to
the exact sentences that produced it, so a user can verify the call in a few seconds and a
maintainer can see why their repo was labelled the way it was. This keeps the tool free, offline
for everything except the GitHub API, deterministic and easy to test with fixture strings. The
trade-off is recall and nuance: policies phrased in unusual ways, written in another language, or
spread across a linked website are missed or labelled `neutral`, and a sentence that both
discourages and permits AI use can be misread. That is why the AI policy and gates together carry
only 20 of the 100 points, while the measurable signals from the API (PR creation policy, fork
merge share, merge speed and recency) carry the rest.
