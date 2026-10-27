# Changelog

## 0.12.1

### Fixed

- Keep raw Python/JSON tracker metadata out of direct ticket titles; retain a readable ticket subject or generate a task description through OMP's configured title route.

## 0.12.0

### Changed

- Put ticket information first in default titles: `WRAPX-123: Some Stuff — wrap`, with the repository after the task description.
- Without a ticket, use `Some Stuff — wrap`; omit optional separators when their identity field is absent.
- Make `{prefix}` the optional ticket-only prefix and add `{suffix}` for the optional repository suffix. Custom formats using `{prefix}` should add `{suffix}` to retain the repository; explicit raw-field formats and full-title prompts keep their ordering.

## 0.11.1

### Changed

- Organize plain JavaScript source, tests, and the bundled prompt into responsibility-focused directories.
- Separate extension registration, lifecycle decisions, generation ownership, native repair, status rendering, pure context handling, and OMP policy loading.
- Use explanatory operation/state names and flatter control flow while preserving title behavior and existing regression scenarios.

## 0.11.0

### Added

- Customize session titles with project- or user-level `TITLE_SYSTEM.md`, retaining the bundled default when no nonblank override exists.
- Use optional `format` frontmatter for deterministic repository/ticket/description ordering, or plain Markdown for a complete-title prompt.
- Apply prompt edits on the next generation or `/retitle`, and report the next-generation prompt source/mode in `/retitle status`.

### Changed

- Store the default policy in a packaged Markdown asset while retaining default title layout, explicit-subject optimization, ownership, and automatic cadence.

## 0.10.1

### Fixed

- Load version metadata once through `node:fs` instead of a static JSON import, preserving loaded-version reporting while passing OMP's installer legacy-loader validation.

## 0.10.0

### Added

- `/retitle status` reports the version loaded in the current process, process/load identity, current ownership and context, observer/pending-work state, accepted title, repair diagnostics, and recent persisted title writer triggers.
- Argument autocomplete for `status`; unknown `/retitle` arguments report usage without generation.

### Fixed

- Restore an auto-overwritten title at the next same-task completed-turn boundary when conversation progress made immediate listener repair unsafe, without another title-model call.

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
