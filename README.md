# omp-auto-retitle

Intelligent OMP session title management over time.

## What it does

- Listens for `session_compact`.
- Builds title input from the original user request plus compaction history.
- Uses OMP's existing session-title generator and configured `providers.tinyModel`.
- Updates the session title with OMP's auto-title source.
- Skips sessions that were manually named by the user.

## Scope

This plugin is for intelligent session title management over time. It is not just a
"rename after compact" hook.

The title context is built from:

- the first meaningful user request, as the session's original task anchor
- recent compaction summaries, as the session's task history

It intentionally ignores raw recent user turns for title scope, because narrow
maintenance requests like "set package version to 0.7" should not become the
whole session title unless that is reflected in the broader compaction history.

There are no optional plugin features today. OMP may still write
`"enabledFeatures": null` in its plugin lockfile; that means "use default
features" and is expected.

## Compatibility

This extension intentionally relies on current OMP internals so it can preserve OMP's auto-title semantics:

- `ctx.sessionManager.setSessionName(title, "auto", trigger)` keeps repeated plugin retitles marked as auto-generated.
- `@oh-my-pi/pi-coding-agent/utils/title-generator` reuses OMP's existing title generation path, including the configured `providers.tinyModel` value and local/online handling.

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

## Test

```sh
npm test
```
