# Architecture and behavioral contract

## Product boundary

A session title should identify the durable task in session history, not the most recent incidental maintenance step. Automatic retitling runs only after `session_compact`. `/retitle` uses the same pipeline on demand; neither path should rename a manually titled session. It is not a per-message title watcher or an alternative model router.

## Responsibilities

- `index.js`: event/command registration, asynchronous request ownership, and eligibility checks before committing a generated title.
- `title-context.js`: pure selection and normalization of session context. It has no runtime imports, configuration, persistence, or model calls.
- `omp-adapter.js`: the version-coupled OMP generator, settings access, title normalization, and auto-source persistence.

Dependencies point from orchestration to the two leaves. Import helpers from their owning module rather than re-exporting them through the extension entry point. The generator injection used by orchestration tests is not a plugin configuration option.

## Title context

Read the selected branch through `getBranch()`, falling back to `getEntries()` only when the branch API is unavailable. Assistant/tool messages and non-text content do not contribute.

1. The first nonblank user message anchors the original task.
2. Up to five subsequent unique user messages retain recent clarification and title feedback.
3. Up to five unique compaction summaries retain task history, including the triggering compaction if it is not yet present in the branch.

Both recent lists retain the latest occurrence of repeated normalized text, then render chronologically. A summary uses nonblank `shortSummary` before `summary`. Normalize whitespace across the entire selected text, rather than discarding everything after its first line. This preserves goals following headings; it is not Markdown parsing or semantic extraction.

OMP's pinned title generator truncates input at 2,000 JavaScript string characters. The plugin allocates 240 characters to the original task, 160 to each recent user message, and 120 to each summary. Including the current instruction and section labels, the maximum prompt is 1,948 characters. This intentionally trades detail within each item for representation of every context source. Deduplication occurs after normalization and truncation, so texts with identical retained prefixes count as the same context.

Changing the instruction, labels, limits, or counts requires exercising the maximum-size regression; otherwise a plausible-looking prompt can silently lose its newest context upstream. The budget is not a token estimate or a guaranteed title-quality score.

## Asynchronous ownership and persistence

Generation may overlap between compaction and command invocations. A per-session-manager weak map retains the latest request's identity. Only that request may commit; a later request supersedes it even when the later generator returns no title or fails. Other sessions remain independent. Completed or failed current requests release their tracking entry.

The result must also match the captured session ID and branch leaf ID, and the title must still be auto-owned or unowned. A session switch, branch switch, or branch advance while awaiting generation discards the result. This conservative freshness rule can leave the old title in place; the next compaction or `/retitle` can regenerate it. It does not cancel provider work already started.

Blank and unchanged titles cause no write. Successful writes use `setSessionName(title, "auto", "omp-auto-retitle:session_compact")`; the historical trigger is shared by the command and event paths. OMP owns title history persistence and manual-title protection. The plugin also rechecks ownership after generation. Unexpected errors propagate; the plugin does not silently turn errors into success or select another provider.

`/retitle` reports `Session title regenerated` only when the setter succeeds; skipped/unchanged results report `Session title unchanged`.

## Compatibility and model ownership

The adapter intentionally uses three internal surfaces:

- `@oh-my-pi/pi-coding-agent/utils/title-generator` for `generateSessionTitle` and its marker-based output parsing.
- `pi.pi.settings` for the active host settings, including `providers.tinyModel`.
- The session manager's source-aware setter and session/leaf identity methods.

The coding-agent package remains pinned to `16.3.11`; do not remove or update that pin merely to match the installed CLI. An upgrade needs source inspection and fresh-process QA because internal imports and exposed settings may change independently. Development package resolution and a compiled OMP binary are distinct compatibility boundaries. OMP `18.11.1` was exercised with this integration; this is not a claim that every intermediate or future release is supported.

The plugin never picks a model. OMP's existing generator owns configured tiny-role/model resolution, local-vs-online behavior, authentication, and output validation. Preserve that delegation; do not add an online fallback to local generation or change user routes to make QA pass. Missing host settings or no generated title means no rename.

## Language and organization decision

Keep JavaScript ES modules and the existing three-module boundary. The extension API is already JavaScript-native, the pure logic is small, and there is no build step. The audit found context-budget and lifecycle bugs, not a measured compute bottleneck. Another language would require a bridge/subprocess and duplicate OMP integration; TypeScript would add checking setup without replacing behavioral proof. Reconsider typing or a language change when a concrete defect, workload, or consumer requirement outweighs that added maintenance surface.
