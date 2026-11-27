# Agent entry

## Start here

1. [`README.md`](README.md) — product, install, status (`0.9.9`, engine `0.15.3`).
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — trust boundary, envelope, engine gate, config
   writes, updates, invariants.
3. [`docs/README.md`](docs/README.md) — doc map; [`docs/architecture/`](docs/architecture/README.md)
   — three diagrams and their `.mmd` sources.
4. Code entry points: `src-tauri/src/lib.rs`, `commands.rs`, `cli.rs`, `config.rs`, `src/app/`.
5. Deeper command-by-command contract: [`docs/architecture-details.md`](docs/architecture-details.md).

## What this repo is / is not

- **Is:** a Tauri v2 desktop shell (React 19 + TypeScript + MobX) over the `lv24-seo` Python CLI.
  It owns the UI, the allow-listed process bridge, path approvals, config patching and the updater.
- **Is not:** a provider client, crawler, analyzer, report builder or delivery implementation. Do
  not add SEO logic here. If a value is missing or wrong, fix the engine and bump the pin.
- **Is not:** a hosted service or a local HTTP API. There is no loopback server, telemetry or job
  queue. Runs are concurrent child processes with no scheduler.

## Commands (verified)

```bash
npm ci                 # lockfile install, Node 24.x
npm run check          # typecheck + Vitest + web build
npm run dev            # browser shell on http://localhost:1420
npm run typecheck
npm test
npm run build
npm run contract:check # regenerate and fail on drift
npm run test:release   # latest.json, asset allow-list, checksum scripts
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Regenerate and review contracts:

```bash
node scripts/check-contracts.mjs --update
# then review every diff under contracts/ before committing the pin and fixtures together
```

Build a sidecar and a bundle (host-only; PyInstaller does not cross-compile):

```bash
python scripts/build-sidecar.py --engine-version 0.15.3 --target x86_64-pc-windows-msvc
node scripts/verify-sidecar.mjs --root src-tauri/engine --target x86_64-pc-windows-msvc --write
npm run tauri build -- --bundles nsis
npm run package:portable
```

## Repository map

| Path | Purpose |
|---|---|
| `src/app`, `src/pages` | router, layout, dashboard, reports, settings, configuration, recommendations |
| `src/features`, `src/entities`, `src/shared` | Feature-Sliced Design slices; CLI transport and envelope parser in `shared` |
| `src-tauri/src/cli.rs` | command allow-list, argv/env construction, timeouts, cancellation |
| `src-tauri/src/config.rs` | config read/validate/patch, backups, atomic replace |
| `src-tauri/src/commands.rs` | Tauri commands, engine discovery and `MIN_ENGINE_VERSION` |
| `src-tauri/src/paths.rs` | approved roots, canonical paths, Windows device-name rules |
| `contracts/` | generated `config.schema.json`, `cli-v1/*` fixtures, updater schema |
| `scripts/` | sidecar build/verify, contract generation, release asset staging |
| `docs/` | architecture, details, configuration, security, release runbook, release notes |

## Invariants (never break)

- **No engine logic here.** Provider semantics, crawl rules, report values and write gates belong to
  `lv24-seo`. The desktop formats and gates them; it never invents a value or a total.
- **The webview is untrusted.** Every new command needs a short argument allow-list and validation
  in Rust before the spawn. Never accept an executable, shell string or arbitrary path.
- **One envelope.** `{ok, data, meta, warnings}` on success and a typed `error.code` on failure.
  Branch on the code, preserve unknown `meta`, treat exit `5` as warnings.
- **No token in the webview.** Secrets go over stdin once; never log, render, persist in settings or
  include in diagnostics.
- **No provider write without the engine's two-phase gate.** Plan first; append `--confirm` only
  with the plan token. Accepted is not indexed.
- **No downgrade and no unsigned update.** The webview only checks the manifest; Rust verifies the
  signature, binds the version and installs.
- **Exact-process cancellation.** Signal only the recorded child PID/group; never match by name.

## Contract-drift rule

`contracts/` is generated from the pinned engine. A field the desktop parses must exist in the
fixture. When the engine pin changes:

1. read the engine release notes and its contract changes;
2. update `scripts/cli-checksums.json` (`version` and companion pins);
3. run `node scripts/check-contracts.mjs --update`;
4. review every changed fixture and `config.schema.json`; update parsers/tests if a field changed;
5. commit the pin and the regenerated contracts **together**;
6. run `npm run contract:check` — CI fails on drift.

Never hand-edit a generated fixture and never guess an engine field. `--static` checks the manifest
without installing the engine; it is not a substitute for the full check.

## Version bump checklist

The desktop version must agree in: `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml` (`[package] version`), the Git tag `vX.Y.Z`, and the release notes. Update
`Cargo.lock` through a normal build; never hand-edit it.

On an engine pin bump, also update: `scripts/cli-checksums.json` (version, python, pydantic, typer,
pyinstaller), `MIN_ENGINE_VERSION` in `src-tauri/src/commands.rs`, the `engine_version` default in
`.github/workflows/desktop.yml`, the regenerated `contracts/`, the README badge and
`docs/ARCHITECTURE.md`, and the release notes. The workflow rejects a manifest mismatch.

## Gotchas

- Windows paths are case-insensitive; avoid creating `docs/architecture.md` next to
  `docs/ARCHITECTURE.md` (the canonical file is uppercase).
- The dev server is `1420`; there is deliberately no production local HTTP API.
- `LV24_SEO_BIN` is for development only. A `PATH` engine needs
  `LV24_SEO_ALLOW_PATH_ENGINE=1`; otherwise it is ignored.
- Do not co-commit unrelated engine work here. This repo has no engine code.
- Release workflow is manual and owner-gated; do not add push/tag triggers. Never commit or print
  the updater private key.
- `docs/releases/` is history: do not rewrite old notes to match a new version.

## Where to record decisions

Brain project `lv24-seo-optimizer-desktop` (`brain open lv24-seo-optimizer-desktop`,
`brain decision`, `brain attempt`, `brain handoff`). Design docs live in
[`docs/`](docs/README.md); the deep implementation contract is
[`docs/architecture-details.md`](docs/architecture-details.md). Never store tokens or provider data
in the brain.

## Links

- Engine: <https://github.com/LevapVeeskela/lv24-seo-optimizer>
- Docs portal: <https://seo.lv24.by/>
- Contracts: [`contracts/README.md`](contracts/README.md)
- Release runbook: [`docs/release.md`](docs/release.md) · security: [`docs/security.md`](docs/security.md)
