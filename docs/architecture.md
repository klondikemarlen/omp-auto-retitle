# Architecture and behavioral contract

## Product boundary

A session title should identify the durable task in session history, not the most recent incidental maintenance step. Automatic generation runs after the first completed agent run, successful `todo init` replans, changed repository/ticket/original-task identity, and `session_compact`. Ordinary unchanged-task follow-ups do not invoke the title model. `/retitle` forces an on-demand refresh; all paths preserve manual ownership.

## Responsibilities

- `index.js`: trigger eligibility, asynchronous request ownership, and safe restoration after native automatic title writes.
- `title-context.js`: pure selection, identity extraction, bounded model input, and final title composition, including fixed format-field substitution. It has no runtime imports, configuration, persistence, or model calls.
- `omp-adapter.js`: the version-coupled OMP generator, Markdown policy discovery/parsing, settings access, title normalization, source-aware persistence, and native title-listener bridge.

Dependencies point from orchestration to the two leaves. Import helpers from their owning module rather than re-exporting them through the extension entry point. The generator injection used by orchestration tests is not a plugin configuration option.

## Title context

Read the selected branch through `getBranch()`, falling back to `getEntries()` only when the branch API is unavailable. Text content contributes; non-text blocks and tool-call arguments do not.

1. The first nonblank user message anchors the original task.
2. Up to five subsequent unique user messages retain recent clarification and title feedback.
3. Up to five unique compaction summaries retain task history, including the triggering compaction if it is not yet present in the branch.
4. The session working-directory basename supplies the repository/project label (`ctx.cwd`, falling back to the session manager). This is a folder label, not a Git remote lookup; starting inside a subdirectory uses that subdirectory's name.
5. Scan full selected-branch user, assistant, tool-result, and summary text for GitHub issue/pull URLs, short issue/PR references, and Jira keys before applying prose-prefix limits. Retain up to three bounded reference excerpts with nearby description text. These are evidence, not instructions or fetched metadata.

Both recent prose lists retain the latest occurrence of repeated normalized text, then render chronologically. A summary uses nonblank `shortSummary` before `summary`. Normalize whitespace across the entire selected text, rather than discarding everything after its first line.

The latest explicit user reference supplies the title identity; without one, use the latest recognized reference from the selected conversation or summaries. Render that selected evidence last, following up to two other recent unique excerpts, so workflow context does not displace the active task. Attachment indices introduced by image/screenshot/attachment labels are excluded while genuine references later on the same line remain eligible. This is a local heuristic, not remote ticket-state resolution: ambiguous conversations can still need user clarification. GitHub references in other repositories retain owner/repository; same-repository references use `#number` or `PR#number`.

OMP's pinned title generator truncates input at 2,000 JavaScript string characters. Section budgets are 80 characters for the repository, 200 for the original request, 120 per recent user message, 100 per summary, and 130 per reference excerpt. With all slots full and current labels, the maximum input is 1,912 characters. Changing labels, limits, or counts requires exercising the maximum-size regression so the newest context cannot disappear upstream.

With the bundled default policy, when a reference explicitly supplies a colon-delimited subject, retain the latest supplied subject for that same reference and compose the title directly, without a model call. The first sentence is bounded to 120 characters; subjects from another ticket are never reused. Otherwise the adapter asks OMP's generator for the actual task/question description rather than generic workflow labels. The default format is `{prefix}{description}`, where the pure composer supplies `repository reference: ` only when identity exists. A blank model result still means no rename, never an identity-only title. Generated descriptions remain model-dependent; no provider fallback, metadata fetching, or quality retry is added.

### Markdown policy boundary

The bundled `title-prompt.md` is read and parsed once at module evaluation. Generation resolves `TITLE_SYSTEM.md` from the session working directory's `.omp`, `.claude`, `.codex`, then `.gemini` directories, followed by the user-level OMP agent directory and the home-level compatibility directories. OMP's native utility helpers retain its configuration-directory/profile semantics. The adapter mirrors this small search order because `config.ts` is not exposed by the exercised compiled host; importing that source-only subpath fails native startup despite passing the source loader.

Selected override files are read for each generation. Blank overrides select the bundled default; read/parse/format errors propagate without renaming or quietly switching policies. OMP's Markdown frontmatter parser handles YAML. A `format` string supports only `{repository}`, `{reference}`, `{description}`, and `{prefix}`; substitution is a single pass over the format, never evaluation of conversation text. Missing raw fields become empty strings and literal punctuation remains. `{prefix}` supplies the complete optional default prefix. A format-only override uses the bundled description instructions.

With a format, the model generates only its description and pure composition preserves the requested identifier ordering. Plain Markdown without a format controls the complete generated title and bypasses the default prefix. Both custom modes generate even with an explicit ticket subject; default subject optimization remains limited to the bundled policy. Exact full-title prompt compliance is model-dependent, which is why deterministic formatting is available independently of the selected model.

Prompt edits apply at the next eligible generation or `/retitle`; they are not an extra automatic trigger or an in-flight cancellation mechanism. Read-only status resolves the source/mode for the next generation, not the historical policy of an already accepted title. Project policy files are trusted instructions, unlike conversation/tool excerpts. Native recognition of `TITLE_SYSTEM.md` does not imply native support for this plugin's format frontmatter.

## Asynchronous ownership and persistence

Generation may overlap between automatic triggers and command invocations. A per-session-manager weak map retains the latest request's identity. Only that request may commit; a later request supersedes it even when the later generator returns no title or fails. Other sessions remain independent. Accepted-title caching also rechecks ownership after asynchronous persistence, so an older finishing write cannot replace a newer repair cache. Completed or failed current requests release their tracking entry.

The result must match the captured session ID and selected conversation leaf, and the title must remain auto-owned or unowned. Title-history entries are excluded from the freshness leaf because native/plugin title writes append metadata without advancing the conversation. Actual messages, compaction, and branch/session changes still invalidate pending work. This does not cancel provider work already started.

Lifecycle state remembers the last generated identity (repository, active reference, bounded original task), whether a replan is pending, and the last accepted title/context. Branch/tree and session changes reset eligibility; shutdown removes the native observer. Successful replans generate once at the next `agent_end`. An unchanged follow-up advances the accepted context snapshot without generating another title, then restores the accepted title if an auto overwrite was previously deferred. Blank/failed generation does not introduce a retry loop; a later meaningful trigger or `/retitle` may try again.

The native title listener ignores plugin writes and user-owned titles. It restores a cached title without a model call only when session ID, branch epoch, conversation leaf, identity, and current input still match, and no newer generation is pending. A skipped immediate repair records its reason; the next unchanged-task completed turn can safely advance the snapshot and repair without model generation. Task/branch/session changes still prevent stale restoration. Listener/repair errors notify the UI; unavailable listener support emits an explicit warning. The plugin does not disable native settings or patch host methods.

Blank and unchanged titles cause no write. Writes use `setSessionName(title, "auto", "omp-auto-retitle:<reason>")`, where the reason identifies first-task, task, replan, session_compact, command, native-repair, or settled-repair. OMP owns title-history persistence and manual-title protection.

Bare `/retitle` reports `Session title regenerated` only when the setter succeeds; skipped/unchanged results report `Session title unchanged`. Unknown arguments report usage without generation. `/retitle status` is a read-only diagnostic path with argument autocomplete. The adapter captures package version, process ID, module-load time, and entry URL once at module evaluation; status must not reread installed metadata. Lifecycle diagnostics expose current ownership/context, observer availability, pending work, accepted title, repair eligibility and the last outcome. Three persisted title writes expose exact source/trigger values; missing triggers do not establish writer identity.

## Compatibility and model ownership

The adapter intentionally uses these internal surfaces:

- `@oh-my-pi/pi-coding-agent/utils/title-generator` for `generateSessionTitle` and its marker-based output parsing.
- `pi.pi.settings` for active host settings; source-only and compiled generator keys can differ.
- The session manager's source-aware setter, session/leaf identity methods, and `onSessionNameChanged` subscription.
- `@oh-my-pi/pi-utils` for OMP configuration-directory/profile helpers and Markdown frontmatter parsing. This package root is exposed by the compiled host; the coding-agent `config.ts` subpath is not.

The coding-agent package remains pinned to `16.3.11`; do not remove or update that pin merely to match the installed CLI. An upgrade needs source inspection and fresh-process QA because internal imports and exposed settings may change independently. Development package resolution and a compiled OMP binary are distinct compatibility boundaries. OMP `18.12.6` was exercised with this integration; this is not a claim that every intermediate or future release is supported.

Installer validation is a separate import boundary from direct `-e` runtime loading. The legacy extension graph loader handles collected modules as JavaScript/TypeScript, including a relative static JSON import; that import may pass direct runtime QA and fail installation. Package metadata is therefore read once through `node:fs` at module evaluation and copied into the frozen loaded-runtime snapshot. Status never rereads the file.

The plugin never picks a model. OMP's existing generator owns configured model resolution, local-vs-online behavior, authentication, and output validation. The pinned `16.3.11` source generator reads `providers.tinyModel`; the exercised compiled `18.12.6` generator resolves the native `tiny` role instead. Preserve runtime-owned routing rather than adding obsolete settings, an online fallback, or user-route changes to make QA pass. Missing host settings or no generated title means no rename.

## Language and organization decision

Keep JavaScript ES modules and the existing three-module boundary. The extension API is already JavaScript-native, the pure logic is small, and there is no build step. The audit found context-budget and lifecycle bugs, not a measured compute bottleneck. Another language would require a bridge/subprocess and duplicate OMP integration; TypeScript would add checking setup without replacing behavioral proof. Reconsider typing or a language change when a concrete defect, workload, or consumer requirement outweighs that added maintenance surface.
