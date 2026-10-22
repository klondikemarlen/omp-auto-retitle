# Repository guidance

Read [the knowledge base](/docs/README.md), especially the [architecture contract](/docs/architecture.md) and [development/QA procedure](/docs/development.md), before changing retitling behavior.

- Keep context selection and formatting pure in `src/context/`, OMP internals and policy-file loading in `src/omp/`, and request/lifecycle/repair ownership in `src/retitling/`. Keep `index.js` thin and event/command registration in `src/extension.js`.
- Preserve manual-title ownership, selected-branch context, latest-request ownership, and representation of all three context sources within OMP's input budget.
- Keep model selection and local/online policy in OMP. Do not add a provider fallback or change user configuration to obtain a passing check.
- Treat the pinned coding-agent dependency and compiled OMP host as separate compatibility boundaries; inspect and smoke-test both before changing runtime integration.
- Run `npm run release:check` for source changes. Add regressions for observable failures, not exact prompt wording, package metadata, or mock forwarding.
- Run actual fresh-process QA for extension behavior and autocomplete; unit tests do not establish installed compatibility.
- Keep guidance project-specific and linked here, not copied from shared skills. Put transient audit/release evidence in the issue/PR; update durable docs only when the reader contract changes.

Use the issue/branch/PR and scoped-commit procedure in the development guide. This repository releases merged GitHub source through the OMP plugin manager, not an npm publish.
