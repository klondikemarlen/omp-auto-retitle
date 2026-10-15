# Development, QA, and release

## Local development

Use Bun for the OMP runtime's TypeScript dependencies. The plugin itself is plain JavaScript ES modules; no compilation step is needed.

```sh
bun install
npm test
npm run release:check
```

`release:check` delegates to `npm test`, which runs `bun test`. There is no Docker wrapper, database, formatter, separate build gate, or CI workflow in this repository.

## Behavioral verification

- `title-context.test.js` checks multiline intent, the complete 2,000-character input boundary, newest-occurrence ordering, selected-branch isolation, and supported message content.
- `index.test.js` uses real in-memory OMP session managers with controlled generation promises. It checks persistence, stale completion, session/branch switches, manual ownership, blank/unchanged output, independent sessions, and error recovery.

Keep regression assertions about consumer-visible behavior and invariants. Do not pin instruction wording, dependency-version strings, registration plumbing, or implementation layout. Use a throwaway runtime probe for wiring. In-memory session fixtures do not need timers, external credentials, or cleanup hooks.

For a lifecycle change, control promise completion explicitly rather than sleeping. For context changes, fill all sections to their limits and verify that the final compaction still reaches the generator's accepted input. Live title wording is nondeterministic; assert intent and source ownership, not one exact phrase.

## Fresh-process smoke scenarios

Tests do not prove that the installed OMP binary exposes the required internal API. Exercise an actual process before release. For local-source QA, `omp --no-extensions -e ./index.js` loads only this extension and avoids a duplicate installed command. Use a disposable session and do not alter normal model/provider configuration.

1. Give the session a concrete task, such as building accounting imports and reconciling bank transactions. Allow the built-in title generator to finish before the next step.
2. Type `/reti` without submitting. Confirm autocomplete offers `/retitle` with its regeneration description. Submit the command and observe `Session title regenerated` or, if the generated title already matches, `Session title unchanged`. Inspect the session's title/history to confirm a meaningful nonblank title and `source: "auto"`.
3. Manually rename the disposable session through OMP's `/rename` command. Run `/retitle`; confirm `Session title unchanged` and that the manual title remains intact.
4. For an event integration change, compact a disposable session with meaningful history and confirm the same auto-title path runs. For lifecycle changes, the controlled-promise regressions are the deterministic overlap proof; manual timing is not sufficient.

A provider-unavailable result is not successful generation evidence. Report which surfaces were observed and which remain blocked. Never claim that tests alone establish title quality across models.

## Release from GitHub source

This repository's distribution source is GitHub, not npm. Keep implementation/QA evidence in the linked issue and PR rather than committing transient execution reports. The workflow may stage and commit scoped implementation, tests, documentation, and release metadata in separate cohesive commits.

1. Create an issue with acceptance criteria, an issue-named topic branch in the current checkout, and a linked draft PR against `main`. Preserve user-owned changes and branches.
2. Implement and update `package.json` plus the [changelog](/CHANGELOG.md) on the topic branch. Run `npm run release:check`, complete self-review and focused runtime QA, and resolve actionable feedback. Update the PR's existing evidence in place.
3. Merge with a merge commit after applicable checks/review requirements pass. Verify the intended version is in the merged GitHub source before installing; do not commit directly to `main`.
4. Uninstall the old package, then install the merged remote source:

   ```sh
   omp plugin uninstall omp-auto-retitle
   npm run reinstall
   ```

   `reinstall` runs `omp plugin install github:klondikemarlen/omp-auto-retitle` and follows the default branch. An exact full-commit reference with `--force` is for stale-cache diagnosis, not routine installation.
5. Verify the intended version in both `~/.omp/plugins/node_modules/omp-auto-retitle/package.json` and the package entry of `~/.omp/plugins/omp-plugins.lock.json`. Verify the lock's resolved commit when present. If install fails, restore the previous remote artifact and report the failure; do not leave the user without the plugin.
6. Start a **new OMP process** and repeat autocomplete and command behavior against the installed artifact. Existing processes retain extension modules loaded at startup; a disk update or reload claim is not installed-runtime proof. Observe manual-title preservation too.
7. Record release/install evidence in the PR. Return the checkout to synchronized `main` and remove only the merged agent-owned topic branch. Retain user-owned worktrees and branches.

No bootstrap command is required by this repository. If an external configuration repository owns additional runtime reconciliation, follow that repository's procedure when working there rather than silently editing another checkout.
