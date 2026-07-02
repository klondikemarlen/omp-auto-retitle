# omp-auto-retitle

OMP extension that refreshes auto-generated session titles after compaction.

## What it does

- Listens for `session_compact`.
- Uses the compaction `shortSummary`, falling back to `summary`.
- Updates the session title with OMP's auto-title source.
- Skips sessions that were manually named by the user.

## Compatibility

This extension uses the current OMP session manager path `ctx.sessionManager.setSessionName(title, "auto", trigger)` so repeated plugin retitles stay marked as auto-generated and do not clobber manual titles. That is more version-coupled than the public `pi.setSessionName(name)` action.

## Install locally

Add the extension path to `~/.omp/agent/config.yml` alongside any existing entries:

```yaml
extensions:
  - ~/code/klondikemarlen/omp-auto-retitle
```

Do not replace an existing `extensions` array unless you want to disable the other extensions.

## Enable local title generation

This plugin is separate from OMP's title model. To make OMP generate first-message titles locally on this machine:

```yaml
providers:
  tinyModel: lfm2-350m
```

`lfm2-350m` is the fast local title model documented by OMP.

## Test

```sh
npm test
```
