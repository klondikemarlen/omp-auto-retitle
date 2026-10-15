# Knowledge base

For maintainers and coding agents extending or diagnosing session retitling.

- [Architecture and behavioral contract](/docs/architecture.md): context selection, input budgets, asynchronous ownership, OMP compatibility, and the language decision.
- [Development, QA, and release](/docs/development.md): local checks, installed-plugin scenarios, and GitHub-source release procedure.
- [Changelog](/CHANGELOG.md): released behavior changes.
- [User guide](/README.md): installation, triggers, and model configuration.

## Authority and publication

The user guide and architecture describe intended behavior; implementation is in the three root JavaScript modules. Behavioral tests provide deterministic evidence, while installed-plugin QA covers the OMP integration. If these disagree, reproduce the conflict before changing the contract.

This repository is public. Documentation is repository-facing; there is no documentation-site build or publication pipeline. Any future site must explicitly allowlist its inputs. Keep private session text, credentials, local profile details, and raw workstation logs out of committed documentation and public issue/PR evidence.
