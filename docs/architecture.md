# Architecture

Status: **implementation contract.** The Rust command bridge and product screens are implemented in
this repository. Where this document describes a control, it is the requirement that
implementation must satisfy. The pinned engine is `lv24-seo 0.5.0`.

## 1. Shape

```
┌──────────────────────────────────────────────────────────────┐
│ Webview: React 19 + TypeScript + Vite + MobX                 │
│  app / pages / widgets / features / entities / shared        │
│  settings forms · configuration outputs · reports · jobs     │
│  invoke("config_read") · invoke("cli_run") · events          │
└───────────────────────────┬──────────────────────────────────┘
                            │ Tauri IPC, allow-listed commands
┌───────────────────────────▼──────────────────────────────────┐
│ Rust shell                                                   │
│  config read / validate / write (toml_edit)                  │
│  CLI runner: argv array, stdin, timeout, cancel              │
│  job manager + bounded log events                            │
│  path allow-list · secret stdin bridge · updater             │
└───────────────────────────┬──────────────────────────────────┘
                            │ child process, one workspace at a time
┌───────────────────────────▼──────────────────────────────────┐
│ lv24-seo Python CLI (PyInstaller onedir sidecar)             │
│  --json envelopes · reports · crawl · SQLite · MCP server    │
│  keychain / env / opt-in file secrets                        │
└──────────────────────────────────────────────────────────────┘
```

The desktop is a **UI + local process shell**. It does not reimplement provider clients, crawl
rules, analysis, report builders or delivery. Those remain in `lv24-seo`, which is the engine of
record and the only component that talks to provider APIs.

## 2. Trust boundaries

| Boundary | What crosses it | Control |
|---|---|---|
| Webview → Rust | command name, validated arguments, one-time secret input | fixed command table, argument schemas, no executable or shell string |
| Rust → engine | argv array, optional stdin, config path, cwd | absolute `--config`, `--json`, path allow-list, per-command timeout |
| Engine → provider | user credentials, queries, site URLs | engine-owned HTTP clients, rate limits, read-only defaults |
| Engine → local disk | SQLite, reports, snapshots | configured data directory; desktop does not invent paths |
| Desktop → GitHub | update metadata and signed artifacts | Tauri updater signature; no telemetry |

The webview is untrusted input. It can request a known operation with validated arguments; it cannot
choose an executable, construct a shell command, read arbitrary files, or write outside the approved
roots. The Rust layer is the authorization boundary. The engine is trusted to enforce provider
semantics and its own write gates.

## 3. No local HTTP API

There is **no local HTTP API** in v0.1. The CLI already returns stable `--json` envelopes, and a
loopback server would add authentication, CSRF/proxy handling and another lifecycle to secure for
little gain. The desktop uses a direct child-process bridge.

A future local API is allowed only as an explicit, opt-in design with its own authentication and
loopback binding. It is not a dependency of the current architecture.

## 4. Command bridge

All engine calls use:

- an **argument array**, never a shell string;
- an absolute `--config` path (or an explicit onboarding workspace);
- `--json` and one parsed envelope;
- a bounded timeout and an exact child handle for cancellation;
- `cwd = config parent` so a relative `storage.data_dir` resolves like a terminal run.

The envelope is:

```ts
type Envelope<T> =
  | { ok: true; data: T; meta: Record<string, unknown>; warnings: string[] }
  | { ok: false; error: { code: string; message: string; next_action?: string; retryable?: boolean };
      meta: Record<string, unknown>; warnings: string[] };
```

Rules:

- `ok=false` is a typed UI error, not a crash and not a reason to guess.
- Branch on `error.code`, not the exit code. `WRITE_DISABLED`, `CONFIRM_REQUIRED` and configuration
  errors can all exit `2`.
- Preserve unknown `meta` keys for diagnostics; tolerate additive fields.
- `stdout` is JSON only. `stderr` is bounded and redacted before display.
- The exit code is shown in diagnostics but the envelope is authoritative.
- Set `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` so non-ASCII paths and text survive Windows code
  pages.
- On Windows, launch with `CREATE_NO_WINDOW`; capture stdout/stderr as UTF-8 with a bounded buffer.

The command table is intentionally small and fixed. A representative set:

| Desktop command | Engine call | Class |
|---|---|---|
| `desktop_status` | `version --json` | read |
| `config_read` | `config show --json` | read |
| `config_init` | `init --property ... --data-dir ...` | write |
| `config_validate` | `config show --config <temp> --json` | read |
| `doctor` | `doctor --json` | read |
| `providers` | `properties --json` | read |
| `auth_status` | `auth status --json` | read |
| `auth_set` | `auth set --provider <p> --stdin` | write, secret stdin |
| `auth_delete` | `auth logout --provider <p> --json` | write, confirm |
| `gsc_query` | `gsc query ... --json` | read |
| `yandex_queries` | `yandex queries --json` | read |
| `crawl_run` | `crawl ... --json` | local write, cancellable |
| `report_weekly` | `report weekly ... --json` | read/write snapshot |
| `report_send` | `report weekly --send --json` | external send, confirm |
| `report_diff` | `report diff ... --json` | read |
| `schedule_preview` | `schedule print ... --json` | read |
| `schedule_install` | `schedule install ... --json` | host write, confirm |
| `mcp_install` | `install --client ... --json` | host write, confirm |
| `export_skills` | `export skills --out ... --json` | file write, path picker |

Adding a command requires a reviewed Rust change, an argument schema, a fixture and a test. The
webview cannot add one at runtime.

## 5. Engine discovery and version gate

Resolution order:

1. `LV24_SEO_BIN` (absolute path; development or an explicitly chosen system engine);
2. the bundled resource `lv24-seo/lv24-seo[.exe]`;
3. a sibling `lv24-seo/` directory next to the app;
4. `PATH`, only after an explicit user opt-in;
5. development fallback `uvx --from lv24-seo==<pinned> lv24-seo`, clearly labelled as a development
   fallback.

A release build never downloads or executes code from the webview. On startup the shell runs
`lv24-seo version --json`, requires the exact pinned version (or an explicitly allowed mismatch),
and shows both desktop and engine versions. A mismatch is a blocking, actionable dialog, not a
silent downgrade.

## 6. Configuration write model

Structured forms edit a draft model. The save flow is:

1. build a TOML patch with `toml_edit` so comments and key order survive;
2. write a temporary file next to the target;
3. validate it with `lv24-seo config show --config <temp> --json`;
4. create a timestamped backup, keeping the last five;
5. atomically replace the target;
6. re-read and show the effective redacted config.

Form saves are field-level patches, so comments, key order and unrelated external edits survive. If
another process changed the file, reload before saving so the form reflects the current file; the
diff tab shows saved-vs-draft fields. Windows file locks produce a retry message, not a partial write.

Raw TOML is shown read-only in the configuration output. Edits go through the form draft, which is
validated by the engine before a patch is written. A parse error blocks the form and names the line
and column. Environment overrides are read-only badges: the UI shows the variable name and explains
that the environment wins over the file. Values are never displayed.

## 7. Jobs and failure model

A job has a kind, parameters, status (`queued`, `running`, `succeeded`, `partial`, `failed`,
`cancelled`), timestamps, exit code, envelope and bounded log tail. Jobs are serialized per
workspace/data directory because the SQLite writer and delivery can block.

- No fake percentages. Until the engine emits `--progress ndjson`, the UI shows an indeterminate
  bar, elapsed time and a phase label marked as an estimate.
- Cancel kills the exact child process tree. A cancelled crawl stores nothing (the engine persists
  at the end); a cancelled delivery can leave an unknown send state, which the UI must say.
- Partial failure (`ok=true` with incomplete meta, or exit `5`) is “completed with warnings”, never
  a clean success.
- A missing token is configuration, not an outage. A no-data report is neutral, not an error.
- Provider failures are isolated and named in `sources_failed`; they do not cancel the whole report.

## 8. Frontend architecture

Feature-Sliced Design, dependencies pointing downward:

```
app/        root store, providers, router, layout, global styles
pages/      onboarding, dashboard, project, providers, report settings,
            crawl settings, storage, configuration, reports, crawl,
            queries, automation, settings, diagnostics
widgets/    app header/nav, health strip, report summary, config panel
features/   save-config, validate-config, set-secret, run-report, run-crawl,
            schedule-preview, mcp-install, export-skills, update-check
entities/   config, provider, secret, report, crawl, schedule, job, settings
shared/     envelope parser, Tauri transport, i18n, UI primitives, formatting
```

- One public API per slice; no imports of another slice's internals.
- The envelope parser and error mapping live in `shared`; screens never parse raw process output.
- UI locale (`en`, `ru`, `zh`) is independent from `report.locale`. Machine codes are never
  translated; unknown codes are shown raw.
- Accessibility is a requirement: WCAG 2.2 AA, visible focus, skip link, focus restoration after
  dialogs, keyboard tables, no color-only meaning, reduced motion and 200% zoom.

## 9. Contracts

- `contracts/config.schema.json` is generated from the pinned engine's `SeoConfig` JSON schema.
- `contracts/cli-v1/*.json` are normalized envelopes recorded from the pinned engine.
- `contracts/stats-v1.md` explains the stats fields; `contracts/cli-v1/stats.json` is generated
  from the pinned engine's `stats` command.
- `scripts/gen-contracts.py` regenerates; `scripts/check-contracts.mjs` fails on drift.
- The desktop pins the engine version and refuses an unknown major/minor combination rather than
  guessing at field semantics.

See [`contracts/README.md`](../contracts/README.md).

## 10. Packaging

The release sidecar is a **PyInstaller onedir** tree, not onefile:

- onedir starts quickly, keeps `_internal/` adjacent and is less AV-prone;
- onefile extracts to a temp directory on every call, starts slowly and is unsuitable for macOS
  signing;
- the tree is placed under `src-tauri/engine/lv24-seo/` and mapped into Tauri resources as
  `lv24-seo/`;
- the shell resolves `<resource_dir>/lv24-seo/lv24-seo[.exe]`;
- `scripts/build-sidecar.py` builds it with `uv` and explicit collect flags;
- `scripts/verify-sidecar.mjs` checks the executable version and SHA-256 against
  `scripts/cli-checksums.json`;
- auto-update is disabled by default (`createUpdaterArtifacts: false`, no updater endpoint);
  if enabled later, it uses Tauri's Ed25519/minisign key, separate from OS code signing and
  notarization, which are currently not purchased.

See [`docs/release.md`](release.md) and [`docs/security.md`](security.md).
