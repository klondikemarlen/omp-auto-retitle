# Architecture and behavioral contract

## Product boundary

A session title should identify the durable task in session history, not the most recent incidental maintenance step. Automatic generation runs after the first completed agent run, successful `todo init` replans, changed repository/ticket/original-task identity, and `session_compact`. Ordinary unchanged-task follow-ups do not invoke the title model. `/retitle` forces an on-demand refresh; all paths preserve manual ownership.

## Responsibilities

| Owner | Responsibility |
| --- | --- |
| `index.js` | Stable OMP entry point; delegates registration to `src/extension.js`. |
| `src/extension.js` | Registers events and the `/retitle` command; dispatches to retitling operations. |
| `src/context/session-context.js` | Assembles bounded selected-branch input and repository/task identity. |
| `src/context/work-references.js` | Recognizes and selects ticket/PR evidence and explicit subjects. |
| `src/context/context-text.js` | Extracts text, normalizes bounded prose, and retains recent unique values. |
| `src/context/title-format.js` | Validates fixed format fields, bounds grounded request excerpts, and composes titles without runtime dependencies. |
| `src/retitling/session-retitler.js` | Owns session lifecycle, automatic refresh eligibility, and observer cleanup. |
| `src/retitling/generate-title.js` | Owns latest-request freshness, generation, persistence, and accepted-title caching. |
| `src/retitling/repair-title.js` | Decides whether cached titles can be restored safely and performs restoration. |
| `src/retitling/title-status.js` | Renders read-only runtime and repair diagnostics. |
| `src/retitling/session-identity.js` | Defines task identity and the conversation leaf excluding title metadata. |
| `src/omp/omp-adapter.js` | Bridges version-coupled host generation, source-aware persistence, native observation, and loaded-runtime identity. |
| `src/omp/title-policy.js` | Discovers and parses Markdown policies, using pure format validation. |

Dependencies flow from extension wiring to retitling operations, then to pure context helpers and OMP integration. Pure context modules never import runtime integration. Status reads repair eligibility without owning lifecycle state; repair and generation do not call the event coordinator. Import operations from their owning module rather than re-exporting them through the extension entry point. Test-only generator/policy injection is not plugin configuration.

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

With the bundled default policy, a readable colon-delimited subject belonging to the selected reference is composed directly, without a model call. Raw Python dictionaries and JSON tracker containers cannot replace a prior readable subject or bypass generation. Subjects are bounded to 120 characters and never reused for another ticket. Otherwise the adapter asks OMP for a task/question description. The default `{prefix}{description}{suffix}` format supplies an optional `reference: ` prefix and ` — repository` suffix.

Model synthesis is not the only path to a usable default title. On empty output, a generator error, or a 10-second deadline, retain an accepted default-policy title for the same session, branch, and task identity. Otherwise, only without a selected ticket, use the bounded original request as an excerpt, truncated at a word boundary to at most 120 characters. Bare links, structured-data prefixes, and simple acknowledgements are excluded. This is explicitly reported as a fallback, not a generated summary. Unknown ticket descriptions remain unavailable rather than acquiring an unrelated original task or an identity-only title. Custom policies never receive default fallback text. Policy-loading and persistence errors propagate; they are not model failures.

### Markdown policy boundary

The bundled `prompts/default-title.md` is read and parsed once at module evaluation. Generation resolves `TITLE_SYSTEM.md` from the session working directory's `.omp`, `.claude`, `.codex`, then `.gemini` directories, followed by the user-level OMP agent directory and the home-level compatibility directories. OMP's native utility helpers retain its configuration-directory/profile semantics. The policy loader mirrors this small search order because `config.ts` is not exposed by the exercised compiled host; importing that source-only subpath fails native startup despite passing the source loader.

Selected override files are read for each generation. Blank overrides select the bundled default; read/parse/format errors propagate without renaming or quietly switching policies. OMP's Markdown frontmatter parser handles YAML. A `format` string supports only `{repository}`, `{reference}`, `{description}`, `{prefix}`, and `{suffix}`; substitution is a single pass over the format, never evaluation of conversation text. Missing raw fields become empty strings and literal punctuation remains. `{prefix}` and `{suffix}` supply the complete optional ticket prefix and repository suffix.

With a format, the model generates only its description and pure composition preserves the requested identifier ordering. Plain Markdown without a format controls the complete generated title and bypasses the default prefix. Both custom modes generate even with an explicit ticket subject; default subject optimization remains limited to the bundled policy. Exact full-title prompt compliance is model-dependent, which is why deterministic formatting is available independently of the selected model.

Prompt edits apply at the next eligible generation or `/retitle`; they are not an extra automatic trigger or an in-flight cancellation mechanism. Read-only status resolves the source/mode for the next generation, not the historical policy of an already accepted title. Project policy files are trusted instructions, unlike conversation/tool excerpts. Native recognition of `TITLE_SYSTEM.md` does not imply native support for this plugin's format frontmatter.

## Asynchronous ownership and persistence

Generation may overlap between automatic triggers and command invocations. A per-session-manager weak map retains the latest request's identity and abort controller. Only that request may commit; a later request supersedes it even when the later generation fails. Supersession, branch/session resets, and shutdown abort the prior request and release its wait. Other sessions remain independent. Accepted-title caching rechecks ownership after asynchronous persistence, so an older finishing write cannot replace a newer repair cache. Completed or failed current requests release tracking, timers, and abort listeners.

The result must match the captured session ID and selected conversation leaf, and the title must remain auto-owned or unowned. Title-history entries are excluded because title writes append metadata without advancing the conversation. Actual messages, compaction, and branch/session changes still invalidate pending work. The adapter passes the signal in the compiled host's eighth generator argument; pinned source `16.3.11` ignores it, so the plugin also races its wait against cancellation. A late result from an older host cannot commit, even if inference continues there.

Lifecycle state remembers the current identity (repository, active reference, bounded original task), whether a replan is pending, the last generation outcome, and the last accepted title/context/policy. Only acceptance marks generation successful. An unsuccessful automatic attempt remains eligible at the next completed turn; an accepted fallback counts as a useful title and avoids repeated same-task requests. Branch/tree and session changes reset eligibility; shutdown removes the observer and invalidates pending work. Successful replans generate once at the next `agent_end`. An unchanged follow-up advances the accepted context snapshot and restores a deferred auto overwrite without another model call. No timer retries or provider fallback are introduced.

The native title listener ignores plugin writes and user-owned titles. It restores a cached title without a model call only when session ID, branch epoch, conversation leaf, identity, and current input still match, and no newer generation is pending. A skipped immediate repair records its reason; the next unchanged-task completed turn can safely advance the snapshot and repair without model generation. Task/branch/session changes still prevent stale restoration. Listener/repair errors notify the UI; unavailable listener support emits an explicit warning. The plugin does not disable native settings or patch host methods.

Blank and unchanged titles cause no write. Writes use `setSessionName(title, "auto", "omp-auto-retitle:<reason>")`, where the reason identifies first-task, task, replan, session_compact, command, native-repair, or settled-repair. OMP owns title-history persistence and manual-title protection.

Bare `/retitle` distinguishes model/subject updates, unchanged titles, grounded fallback, unavailable generation, protected manual titles, missing context, and discarded stale requests. Fallback and unavailable outcomes notify at warning severity; automatic triggers also report them. `/retitle status` is read-only and includes the last generation outcome, so empty output no longer masquerades as an unchanged title. Unknown arguments report usage without generation; argument autocomplete offers `status`. The adapter captures package version, process ID, module-load time, and entry URL once at evaluation. Lifecycle diagnostics expose ownership/context, observer availability, pending work, accepted title, and repair eligibility/outcome. Three persisted writes expose exact source/trigger values; missing triggers do not establish writer identity.

## Compatibility and model ownership

The adapter intentionally uses these internal surfaces:

- `@oh-my-pi/pi-coding-agent/utils/title-generator` for `generateSessionTitle` and its marker-based output parsing.
- `pi.pi.settings` for active host settings; source-only and compiled generator keys can differ.
- The session manager's source-aware setter, session/leaf identity methods, and `onSessionNameChanged` subscription.
- `@oh-my-pi/pi-utils` for OMP configuration-directory/profile helpers and Markdown frontmatter parsing. This package root is exposed by the compiled host; the coding-agent `config.ts` subpath is not.

The coding-agent package remains pinned to `16.3.11`; do not remove or update that pin merely to match the installed CLI. Development package resolution and a compiled OMP binary are distinct compatibility boundaries. OMP `18.18.7` was exercised with this integration, including its optional eighth-argument abort signal; this is not a claim that every intermediate or future release is supported.

Installer validation is a separate import boundary from direct `-e` runtime loading. The legacy extension graph loader handles collected modules as JavaScript/TypeScript, including a relative static JSON import; that import may pass direct runtime QA and fail installation. Package metadata is therefore read once through `node:fs` at module evaluation and copied into the frozen loaded-runtime snapshot. Status never rereads the file.

The plugin never picks a model. OMP owns configured model resolution, local-vs-online behavior, authentication, and output validation. Pinned source reads `providers.tinyModel`; exercised compiled hosts resolve the native `tiny` role. Preserve runtime-owned routing rather than adding obsolete settings, an online fallback, or user-route changes to make QA pass. Missing host settings is a visible generation failure and follows the same default-policy fallback/custom-policy preservation rules as unavailable inference. Native null output does not distinguish worker, credential, provider, and validation failures; status must not invent that distinction.

## Language and organization decision

Keep JavaScript ES modules with no build step. Group modules by responsibility under `src/context/`, `src/retitling/`, and `src/omp/`; keep registration separate from lifecycle decisions, generation ownership, restoration, and diagnostics. The original three root modules grew to mix these responsibilities as automatic refreshes and Markdown policies were added. This split makes each invariant's owner explicit without a framework, compatibility re-exports, or a new dependency. Another language would require a bridge/subprocess and duplicate OMP integration; TypeScript would add checking setup without replacing behavioral proof. Reconsider typing or a language change when a concrete defect, workload, or consumer requirement outweighs that added maintenance surface.
