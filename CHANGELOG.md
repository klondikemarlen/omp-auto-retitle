# Changelog

## 0.7.7

### Fixed

- Prevent older overlapping title generations from overwriting a newer request's result.
- Discard results after a session switch, branch switch/advance, or manual rename during generation.
- Preserve multiline goals and cap every context source so original intent, recent feedback, and compaction history fit OMP's title-input budget.
- Keep repeated compaction summaries in latest-occurrence order.

### Changed

- Replace prompt-wording and wiring checks with behavioral context and real in-memory session regressions.
- Add a maintainer knowledge base and focused repository guidance covering architecture, compatibility, language tradeoffs, QA, and GitHub-source releases.
