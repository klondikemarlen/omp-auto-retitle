# Changelog

## 0.9.0

### Changed

- Generate useful titles after the first completed agent run, successful replans, and active repository/ticket changes instead of waiting for compaction.
- Keep ordinary same-task follow-ups free of additional title-model calls, while retaining compaction and `/retitle` refreshes.
- Use explicitly supplied ticket subjects directly, avoiding model-generated workflow labels and unnecessary title calls.
- Restore current plugin titles after late native automatic title writes without another model call or global configuration changes.

### Fixed

- Do not mistake image, screenshot, or attachment indices for GitHub issue numbers.
- Treat title-history metadata separately from conversation changes when checking request freshness.

## 0.8.0

### Changed

- Identify sessions with a deterministic repository and Jira/GitHub issue or PR prefix, followed by a generated task or question description.
- Retain bounded ticket/PR excerpts from selected-branch conversation and tool results, including descriptions beyond the old prose-prefix limits.
- Supply task-description guidance through OMP's title-specific system prompt without changing model selection or local/online policy.

## 0.7.8

### Changed

- Align behavioral tests with shared naming and Arrange/Act/Assert conventions without changing runtime behavior.
- Document the separate test-alignment gate so passing behavioral tests is not mistaken for complete pre-merge verification.

## 0.7.7

### Fixed

- Prevent older overlapping title generations from overwriting a newer request's result.
- Discard results after a session switch, branch switch/advance, or manual rename during generation.
- Preserve multiline goals and cap every context source so original intent, recent feedback, and compaction history fit OMP's title-input budget.
- Keep repeated compaction summaries in latest-occurrence order.

### Changed

- Replace prompt-wording and wiring checks with behavioral context and real in-memory session regressions.
- Add a maintainer knowledge base and focused repository guidance covering architecture, compatibility, language tradeoffs, QA, and GitHub-source releases.
