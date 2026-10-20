# omp-auto-retitle

Intelligent OMP session title management over time.

## What it does

- Listens for `session_compact`.
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
so it does not depend on the title model remembering identifiers.

OMP generates the short task description from the original request, recent
clarifications, and compaction history. Without a ticket, it summarizes the
actual task or question. It prefers durable user goals over temporary
implementation details. Description quality still depends on the configured
title model and the details available in the session.

For trust and stability, automatic retitling stays tied to `session_compact`.
Retitling on every user prompt would increase churn and let narrow subtasks
overweight the session title. Use `/retitle` when you want to test or correct
the title immediately.

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
