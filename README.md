# omp-auto-retitle

Intelligent OMP session title management over time.

## What it does

- Generates after the first completed agent run, explicit replans, and active repository/ticket changes; also refreshes after `session_compact`.
- Builds title context from the working-directory name, ticket/PR references, original user request, recent user context, and compaction history.
- Uses OMP's existing session-title generator and configured `providers.tinyModel`.
- Updates the session title with OMP's auto-title source.
- Skips sessions that were manually named by the user.
- Adds `/retitle` for on-demand verification without retitling on every prompt.

## Scope

This plugin is for intelligent session title management over time. It is not just a
"rename after compact" hook.

Titles use `repo ticket: task description`, for example:

- `omp-verifier #150: Reassess advisor repairs`
- `ledger ACC-42: Reconcile bank imports`
- `ledger PR#42: Prevent duplicate imports`
- `ledger: Explain duplicate transactions`

The repo/project label comes from the session working-directory basename. GitHub
issue/PR URLs, short references such as `#150` or `PR #42`, and Jira keys are
recognized in selected-branch conversation and compaction history. Relevant
assistant/tool excerpts can supply a ticket or PR description even when the
user only pasted a link. This does not fetch Jira/GitHub metadata.

The latest explicit user reference takes priority; otherwise the latest
recognized conversation/summary reference is used. Cross-repository GitHub
references retain their owner/repository. The identity prefix is added locally,
so it does not depend on the title model remembering identifiers. Attachment
indices such as `Image #1` or `Screenshot #2` are not ticket references.

When a reference supplies an explicit `KEY: subject` or `#number: subject`, the
plugin uses that grounded subject directly. The same ticket retains its latest
supplied subject across incidental replans, without a model call.
Otherwise OMP generates a short description from the original request, recent
clarifications, and compaction history. Without a ticket, it summarizes the
actual task or question. Generated wording still depends on the configured
title model and the details available in the session.

Automatic generation runs after the first completed agent run in each session,
after a successful `todo init` replan, when repository/ticket identity changes,
and after compaction. Ordinary follow-ups with unchanged task identity do not
call the title model again. A different no-ticket goal can be introduced through
a replan or refreshed explicitly with `/retitle`.

OMP can still generate its own initial/replan titles. If a late native auto
write replaces a current plugin title, the plugin restores its accepted title
without another model call. It never restores a title across changed conversation
history, session/branch changes, newer pending generation, or manual ownership.
No global settings are changed.

There are no optional plugin features today. OMP may still write
`"enabledFeatures": null` in its plugin lockfile; that means "use default
features" and is expected.

## Maintainer knowledge base

See the [knowledge base](/docs/README.md) for the behavioral contract, architecture
and language decisions, compatibility boundaries, and development/QA procedures.
The implementation remains three JavaScript ES modules with no build step.

## Compatibility

This extension intentionally relies on current OMP internals so it can preserve OMP's auto-title semantics:

- `ctx.sessionManager.setSessionName(title, "auto", trigger)` keeps repeated plugin retitles marked as auto-generated.
- `@oh-my-pi/pi-coding-agent/utils/title-generator` reuses OMP's existing title generation path, including the configured `providers.tinyModel` value, local/online handling, and marker-based output parsing.
- `ctx.sessionManager.onSessionNameChanged(...)` observes late native automatic title writes; its subscription is removed when the session shuts down.

Those are more version-coupled than the public `pi.setSessionName(name)` action.

## Install from GitHub

```sh
omp plugin install github:klondikemarlen/omp-auto-retitle
```

## Local title generation

This plugin does not pick a model itself. It calls OMP's title generator, so OMP decides from your normal config:

```yaml
providers:
  tinyModel: online      # default, online tiny-title path
  # tinyModel: lfm2-350m # local title model, if you opted into local titling
```

## Release

Releases are merged GitHub source, installed through OMP's plugin manager rather
than npm. Follow the [release procedure](/docs/development.md#release-from-github-source),
including uninstall/reinstall, version verification, and behavior/autocomplete QA
in a new OMP process. See the [changelog](/CHANGELOG.md) for behavior changes.

## Test

```sh
npm test
```
