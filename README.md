# omp-auto-retitle

OMP extension that refreshes auto-generated session titles after compaction.

## What it does

- Listens for `session_compact`.
- Uses the compaction `shortSummary`, falling back to `summary`, as input to OMP's existing session-title generator.
- Updates the session title with OMP's auto-title source.
- Skips sessions that were manually named by the user.

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
