# omp-auto-retitle

Intelligent OMP session title management over time.

## What it does

- Listens for `session_compact`.
- Builds title input from the original user request, recent user context, and compaction history.
- Uses OMP's existing session-title generator and configured `providers.tinyModel`.
- Updates the session title with OMP's auto-title source.
- Skips sessions that were manually named by the user.
- Adds `/retitle` for on-demand verification without retitling on every prompt.

## Scope

This plugin is for intelligent session title management over time. It is not just a
"rename after compact" hook.

The title context is built from:

- the first meaningful user request, as the session's original task anchor
- recent user context, so later clarifications, final deliverables, and explicit title feedback can steer the title
- recent compaction summaries, as the session's task history

The title prompt asks OMP's generator to prefer durable user goals over
temporary implementation details, so narrow maintenance requests like "set
package version to 0.7" do not become the whole session title by themselves.

For trust and stability, automatic retitling stays tied to `session_compact`.
Retitling on every user prompt would increase churn and let narrow subtasks
overweight the session title. Use `/retitle` when you want to test or correct
the title immediately.

There are no optional plugin features today. OMP may still write
`"enabledFeatures": null` in its plugin lockfile; that means "use default
features" and is expected.

## Code organization

The implementation is split by concern for readability and low complexity:

- `index.js` wires the OMP extension event and orchestration.
- `title-context.js` is pure title-context/domain logic.
- `omp-adapter.js` owns OMP runtime calls and version-coupled internals.

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

## Release checklist

For this repo, "release" means push the GitHub source and reinstall through
OMP's plugin manager from that remote source.

1. Run the local release check:

   ```sh
   npm run release:check
   ```

2. Commit the intended files.
3. Push `main`.
4. Reinstall from GitHub:

   ```sh
   npm run reinstall
   ```

5. Verify `~/.omp/plugins/node_modules/omp-auto-retitle/package.json` and
   `~/.omp/plugins/omp-plugins.lock.json` show the intended version.
6. Restart or reload OMP so the installed extension is loaded.

## Test

```sh
npm test
```
