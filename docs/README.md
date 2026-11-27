# Documentation map

Read in this order:

1. [`../README.md`](../README.md) — product, install, quick start, status.
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — trust boundary, envelope, engine gate, config writes,
   updates, deployment, invariants.
3. [`../AGENTS.md`](../AGENTS.md) — commands, contract-drift rule, version checklist.
4. This file — the rest of the repository documentation.

## Design and operations

| Document | What it covers |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | canonical system design for the desktop shell |
| [`architecture-details.md`](architecture-details.md) | full command-by-command bridge contract and argument allow-lists |
| [`configuration.md`](configuration.md) | settings model, patch/backup/atomic save, reserved fields |
| [`security.md`](security.md) | threat model, secrets, path rules, CSP, update trust |
| [`release.md`](release.md) | versioning, CI gates, manual release workflow, assets, rollback |
| [`releases/`](releases/) | per-version release notes (`0.9.9` is current) |

## Diagrams

[`architecture/README.md`](architecture/README.md) indexes the three committed diagrams. Edit the
`.mmd` source and re-render with `lv24-diagram`; `.svg`/`.png` are generated artifacts.

| Diagram | Question it answers |
|---|---|
| `01-trust-boundary` | What the untrusted webview may ask for, and where authorization happens |
| `02-engine-resolution` | Which engine is used and when it is rejected as incompatible |
| `03-update-pipeline` | Who checks, verifies and installs an update |

## Contracts

| Path | Contents |
|---|---|
| [`../contracts/README.md`](../contracts/README.md) | pin, generation and drift rules |
| `../contracts/config.schema.json` | generated `seo.toml` schema |
| `../contracts/cli-v1/` | generated `--json` envelope fixtures and `manifest.json` |
| `../contracts/latest.schema.json` | updater manifest contract |

## Conventions

- `ARCHITECTURE.md` is the only system-design document; `architecture-details.md` is its detailed
  companion. Old release notes describe the release they name, not current behavior.
- Generated fixtures and diagram renders are never hand-edited.
- The engine remains the source of truth for provider semantics, commands, limits and write gates.
- Public docs: <https://seo.lv24.by/>. Engine repo:
  <https://github.com/LevapVeeskela/lv24-seo-optimizer>.
