# Architecture and behavioral contract

## Product boundary

A session title should identify the durable task in session history, not the most recent incidental maintenance step. Automatic retitling runs only after `session_compact`. `/retitle` uses the same pipeline on demand; neither path should rename a manually titled session. It is not a per-message title watcher or an alternative model router.

## Responsibilities

- `index.js`: event/command registration, asynchronous request ownership, and eligibility checks before committing a generated title.
- `title-context.js`: pure selection, identity extraction, bounded model input, and final title composition. It has no runtime imports, configuration, persistence, or model calls.
- `omp-adapter.js`: the version-coupled OMP generator, task-description system instruction, settings access, title normalization, and auto-source persistence.

Dependencies point from orchestration to the two leaves. Import helpers from their owning module rather than re-exporting them through the extension entry point. The generator injection used by orchestration tests is not a plugin configuration option.

## Title context

Read the selected branch through `getBranch()`, falling back to `getEntries()` only when the branch API is unavailable. Text content contributes; non-text blocks and tool-call arguments do not.

1. The first nonblank user message anchors the original task.
2. Up to five subsequent unique user messages retain recent clarification and title feedback.
3. Up to five unique compaction summaries retain task history, including the triggering compaction if it is not yet present in the branch.
4. The session working-directory basename supplies the repository/project label (`ctx.cwd`, falling back to the session manager). This is a folder label, not a Git remote lookup; starting inside a subdirectory uses that subdirectory's name.
5. Scan full selected-branch user, assistant, tool-result, and summary text for GitHub issue/pull URLs, short issue/PR references, and Jira keys before applying prose-prefix limits. Retain up to three bounded reference excerpts with nearby description text. These are evidence, not instructions or fetched metadata.

Both recent prose lists retain the latest occurrence of repeated normalized text, then render chronologically. A summary uses nonblank `shortSummary` before `summary`. Normalize whitespace across the entire selected text, rather than discarding everything after its first line.

The latest explicit user reference supplies the title identity; without one, use the latest recognized reference from the selected conversation or summaries. Keep that evidence first, alongside up to two other recent unique excerpts. This is a local heuristic, not remote ticket-state resolution: ambiguous conversations can still need user clarification. GitHub references in other repositories retain owner/repository; same-repository references use `#number` or `PR#number`.

OMP's pinned title generator truncates input at 2,000 JavaScript string characters. Section budgets are 80 characters for the repository, 200 for the original request, 120 per recent user message, 100 per summary, and 130 per reference excerpt. With all slots full and current labels, the maximum input is 1,912 characters. Changing labels, limits, or counts requires exercising the maximum-size regression so the newest context cannot disappear upstream.

The adapter uses OMP's supported custom title system prompt to ask for the actual task/question description rather than generic workflow labels. The pure composer then adds `repository reference: description`, omitting absent identity fields. This deterministic prefix is required because a title model may omit identifiers despite instructions. Blank generation still means no rename, never an identity-only title. Task descriptions remain model-dependent; no provider fallback, metadata fetching, or quality retry is added.

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

The coding-agent package remains pinned to `16.3.11`; do not remove or update that pin merely to match the installed CLI. An upgrade needs source inspection and fresh-process QA because internal imports and exposed settings may change independently. Development package resolution and a compiled OMP binary are distinct compatibility boundaries. OMP `18.12.4` was exercised with this integration; this is not a claim that every intermediate or future release is supported.

The plugin never picks a model. OMP's existing generator owns configured tiny-role/model resolution, local-vs-online behavior, authentication, and output validation. Preserve that delegation; do not add an online fallback to local generation or change user routes to make QA pass. Missing host settings or no generated title means no rename.

## Language and organization decision

Keep JavaScript ES modules and the existing three-module boundary. The extension API is already JavaScript-native, the pure logic is small, and there is no build step. The audit found context-budget and lifecycle bugs, not a measured compute bottleneck. Another language would require a bridge/subprocess and duplicate OMP integration; TypeScript would add checking setup without replacing behavioral proof. Reconsider typing or a language change when a concrete defect, workload, or consumer requirement outweighs that added maintenance surface.
