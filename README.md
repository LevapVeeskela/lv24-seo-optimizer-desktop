# LV24 SEO Optimizer Desktop

**A local, offline-first desktop control plane for [`lv24-seo`](https://github.com/LevapVeeskela/lv24-seo-optimizer).**
The Python CLI remains the engine of record; the desktop is a Tauri v2 shell, a React UI and a
careful process bridge around it. No cloud account, no telemetry, no local HTTP API, no SERP
scraping.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Status: pre-release](https://img.shields.io/badge/status-pre--release-orange.svg)](#public-status)
[![Engine: lv24-seo 0.5.0](https://img.shields.io/badge/engine-lv24--seo%200.5.0-informational.svg)](contracts/README.md)

> **Pre-release.** Contracts, CI, the Tauri command bridge and the React product screens
> (dashboard, settings, configuration, reports and recommendations) are implemented in this
> repository. Windows `0.1.0` preview builds are published as an unsigned NSIS `.exe` and a portable
> `.zip`; Linux and macOS installers are not published yet. The pinned engine is `lv24-seo 0.5.0`,
> which ships the `stats` command described by [`contracts/stats-v1.md`](contracts/stats-v1.md).
> Read [Public status](#public-status) before relying on anything here.

## Screenshot

> **Placeholder, not live data.** The image below is a wireframe placeholder. It will be replaced by
> a real screenshot from a local workspace using synthetic data. It is not a claim that the
> numbers are real or that the UI is final.

![Wireframe placeholder for the future dashboard screenshot](docs/assets/dashboard-placeholder.svg)

## What it is

`lv24-seo-optimizer-desktop` turns the `lv24-seo` CLI into a desktop application for people who do
not want to remember flags:

- **Project and provider settings** for Google Search Console, Yandex Webmaster, Yandex Metrika,
  Bing/IndexNow, Chrome UX Report and PageSpeed Insights.
- **A stats dashboard** built on the bounded `lv24-seo stats --json` envelope:
  current values, previous-period comparison, coverage, data age, truncation and limitations.
- **A report view** for the weekly digest: headline, the sections the engine returns, limitations,
  warnings and the generated local HTML report, which opens in your default browser.
- **Configuration output** that is safe to copy: effective redacted JSON, raw TOML, saved-vs-draft
  diff, validation errors, environment-override names and doctor diagnostics.
- **A recommendations-to-agent workflow**: review findings, copy a bounded Markdown prompt or export
  it as `.md`, hand it to a coding agent, then re-run the report to verify the fix.
- **Explicit write gates** for delivery, schedule installation, MCP client installation and any
  provider write action.

## What it is not

- Not a reimplementation of SEO logic, provider clients, crawling or report builders. Those live in
  `lv24-seo`.
- Not a hosted service, not a multi-tenant dashboard, not a place where provider data is uploaded.
- Not a source of fake precision: missing, capped, delayed or failed provider data is shown as
  missing, capped, delayed or failed.
- Not a way to bypass provider quotas or to scrape Google/Yandex result pages.
- Not signed or notarized by a paid certificate authority. See [Unsigned builds](#unsigned-builds).

## Install and develop

### Windows installers (0.1.0 preview)

Download from [Releases](https://github.com/LevapVeeskela/lv24-seo-optimizer-desktop/releases):

| File | Use |
|---|---|
| `LV24 SEO Optimizer_0.1.0_x64-setup.exe` | NSIS installer; installs per user and adds a Start menu entry |
| `LV24-SEO-Optimizer_0.1.0_x64-portable.zip` | extract the whole `LV24 SEO Optimizer` folder and run `lv24-seo-desktop.exe` |
| `SHA256SUMS.txt` | verify the downloaded files before running |

Full notes, install steps and limitations: [`docs/releases/0.1.0.md`](docs/releases/0.1.0.md).

Both builds are **unsigned**. Windows SmartScreen or antivirus software may warn; verify the
SHA-256 first. The bundled `lv24-seo 0.5.0` engine is inside the app resources, so no separate Python
installation is required. The portable ZIP expects the `lv24-seo\` folder to stay next to the app.
"Portable" means no installer; the app still keeps its own `settings.json` under `%APPDATA%`.

```powershell
$files = @(
  "LV24 SEO Optimizer_0.1.0_x64-setup.exe"
  "LV24-SEO-Optimizer_0.1.0_x64-portable.zip"
)
$sums = Get-Content .\SHA256SUMS.txt
foreach ($file in $files) {
  $line = $sums | Where-Object { $_ -match [regex]::Escape($file) } | Select-Object -First 1
  if (-not $line) { "FAIL $file (not listed)"; continue }
  $expected = $line.Split()[0]
  $actual = (Get-FileHash ".\$file" -Algorithm SHA256).Hash
  if ($actual -eq $expected) { "OK   $file" } else { "FAIL $file" }
}
```

Windows 10/11 x64 with the Microsoft Edge WebView2 runtime is required. It is present on Windows 11
and most updated Windows 10 systems; the installer can fetch it when missing, while the portable ZIP
cannot.

### Requirements

| Tool | Version | Why |
|---|---|---|
| Node.js | 24.x | Vite, TypeScript and the Tauri CLI |
| Rust | stable (1.85+) | Tauri shell; `rustfmt` and `clippy` |
| Python | 3.12 (3.11+ works) | contract generation and the PyInstaller sidecar |
| [`uv`](https://docs.astral.sh/uv/) | current | reproducible Python environment for the sidecar |
| Tauri prerequisites | current | WebView2 on Windows, WebKitGTK on Linux, Xcode CLT on macOS |

Install the platform prerequisites from the
[Tauri v2 prerequisites guide](https://v2.tauri.app/start/prerequisites/).

### From source

```bash
git clone https://github.com/LevapVeeskela/lv24-seo-optimizer-desktop
cd lv24-seo-optimizer-desktop
npm ci
npm run check              # typecheck + unit tests + web build
```

Run the UI in a browser shell:

```bash
npm run dev                # Vite on http://localhost:1420
```

Build and run the desktop shell with a locally installed engine:

```bash
# Option A: use an engine you already trust
LV24_SEO_BIN=/absolute/path/to/lv24-seo npm run tauri dev

# Windows PowerShell
$env:LV24_SEO_BIN = "C:\path\to\lv24-seo.exe"; npm run tauri dev
```

The shell resolves `LV24_SEO_BIN`, the bundled `engine/lv24-seo/` resource, or a sibling `lv24-seo/`
folder next to the app. An `lv24-seo` found on `PATH` is ignored unless
`LV24_SEO_ALLOW_PATH_ENGINE=1` is set (`$env:LV24_SEO_ALLOW_PATH_ENGINE = "1"` in PowerShell).

Build the bundled sidecar (PyInstaller **onedir**) and then the Windows installer and portable ZIP:

```bash
python scripts/build-sidecar.py --engine-version 0.5.0 --target x86_64-pc-windows-msvc
node scripts/verify-sidecar.mjs --root src-tauri/engine --target x86_64-pc-windows-msvc --write
npm run tauri build -- --bundles nsis
npm run package:portable
```

`scripts/build-sidecar.py` writes `src-tauri/engine/lv24-seo/` (executable plus `_internal/`). The
committed Tauri config maps that tree to the app's `engine/lv24-seo/` resource directory. The build
is host-only: PyInstaller does not cross-compile, so each target must be built on its own runner.
`npm run package:portable` stages the app plus the sibling `lv24-seo/` tree and writes a `.zip` and
its `.sha256` sidecar under `release/`.

### Checks

```bash
npm run typecheck
npm test
npm run build
npm run contract:check     # regenerate contracts and fail on drift
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

## Supported providers

Provider support comes from the pinned `lv24-seo` engine, not from the desktop. The desktop adds
settings, health status and presentation; it does not add provider adapters.

| Provider | Free tier | Used for | Write actions |
|---|---|---|---|
| Google Search Console | yes (OAuth token today) | queries, pages, countries, devices, URL inspection | sitemap submit is disabled in the engine |
| Yandex Webmaster | yes (OAuth) | queries, indexing history, diagnostics | recrawl is disabled in the engine |
| Yandex Metrika | yes | sessions and users | none |
| Bing Webmaster + IndexNow | yes | queries, crawl issues, instant URL ping | IndexNow submit, explicitly gated |
| Chrome UX Report | yes (API key) | origin-level field Core Web Vitals | none |
| PageSpeed Insights | yes | lab audits per URL | none |
| Your own site | — | crawl, robots, sitemap, JSON-LD, hreflang, links | none |
| nginx access logs | — | Python analysis helpers (no desktop ingest yet) | none |

The desktop never asks for a paid provider key. Optional paid adapters in the engine are
bring-your-own-key and are not part of the default path.

## Stats dashboard

The dashboard renders the stats envelope; it is not a new metric engine. The contract is
[`contracts/stats-v1.md`](contracts/stats-v1.md) and `lv24-seo 0.5.0` ships the command:

- one card per configured provider with the metrics the provider actually returned;
- current values with deltas against the previous window, including CTR deltas in **percentage
  points**, not percent;
- `status` (`ok`, `no_data`, `missing_token`, `not_configured`, `error`), `rows`, `data_age_days`,
  `truncated` and `limitations` visible on the card;
- a coverage banner that says `complete: false` when any configured service is missing, failed,
  empty or truncated;
- no zero-fill and no cross-engine totals. Unknown is shown as unknown.

The pinned engine provides `lv24-seo stats --days 7 --lag-days 2 --json`. The desktop adds no
metrics of its own and shows a blocking compatibility message if the installed engine is older than
the pinned `0.5.0`.

## Reports

The Reports screen runs `report weekly --days 7 --lag-days 2 --json` with
`--out <app data>/exports/reports`. The engine writes `report.json` and `report.html` into that
directory. The screen reads the HTML path from the envelope (`meta.artifacts.html`) and opens it in
your default browser through the Rust `open_path` command, which requires an absolute path, an
approved root and an allowed extension (`.html` included). The desktop never renders the report HTML
inside its own webview.

## Settings and configuration outputs

Settings are grouped by project, providers, report/delivery, crawl, storage and desktop preferences.
Every field has a label, help text, a visible default and validation. Reserved engine fields
(`crawl.concurrency`, `storage.raw_retention_days`, `report.week_start`,
`report.telegram.severity`, `providers.yandex_metrika.goals`) are labelled **no effect**, never
presented as working controls.

The **Settings** screen is the editable form; the **Configuration** screen is the read-only
output and diagnostics view with seven tabs:

1. **Overview** — paths, data directory, engine version and last validation.
2. **Effective JSON** — `lv24-seo config show --json`, redacted.
3. **TOML** — the raw `seo.toml`, comments preserved.
4. **Diff** — saved vs draft, field-level.
5. **Validation** — TOML syntax, schema errors, unknown keys and reserved fields.
6. **Doctor** — the read-only engine environment check.
7. **Environment** — `LV24_SEO_*` variable names and override status; values are never shown.

Saving applies field-level `config_patch` operations, so comments and key order survive. The shell
revalidates with the engine, creates a timestamped backup (last five kept) and atomically replaces
the file. Token values are never persisted by the webview, logged or shown back; the password field
is sent once over IPC. See [`docs/configuration.md`](docs/configuration.md).

## Recommendations to an agent

The desktop is designed to close the loop between “what changed” and “fix it in the repository”:

1. Run the weekly report or the stats dashboard.
2. Review the bounded findings: striking-distance queries, CTR gaps, decayed pages, indexing
   reasons and technical crawl issues. Read the coverage banner first.
3. Copy the finding as a Markdown agent prompt or export it as `.md`. The packet includes the
   period, provider, query/page, observed values, limitations and the exact source command.
4. Paste it into Claude Code, OpenCode, Codex or another coding agent together with the
   `seo-weekly` / `seo-technical-audit` skill. The agent edits the site repository and runs the
   checks it is allowed to run.
5. Re-run the same report or refresh the dashboard in the desktop to verify the change. Do not trust
   the agent's summary without the new envelope.

Any write action that is exposed must require a confirmation dialog naming the exact target and
action. The desktop does not apply site edits itself.

## Security

- **No secrets in the webview.** Token input is a password field sent once over IPC; the Rust layer
  pipes it to `lv24-seo auth set --stdin`. Values are not stored in MobX, logs or diagnostics.
- **No local HTTP API.** The desktop talks to the engine through a fixed, allow-listed process
  bridge. There is no loopback server to authenticate, proxy or expose.
- **No telemetry.** Nothing is uploaded automatically. Diagnostics copies are user-triggered and
  redacted.
- **Strict CSP.** Production builds allow only local assets and Tauri IPC; the development CSP is
  limited to the Vite origin.
- **Command and path allow-lists.** No shell strings, no arbitrary executables. Config paths are
  absolute and chosen through the native dialog; open/export paths are restricted to approved roots.
- **Sidecar integrity.** Release builds use a checksum-pinned PyInstaller onedir tree. Auto-update
  is not initialized in `0.1.0` (no endpoint, no public key); install and upgrade manually.

Read [`docs/security.md`](docs/security.md) and report vulnerabilities through the process in
[`SECURITY.md`](SECURITY.md), not a public issue.

## Unsigned builds

The default build is **unsigned**:

- **macOS:** ad-hoc signed only. Gatekeeper will warn on first launch. Use **System Settings →
  Privacy & Security → Open Anyway**, or right-click → **Open**. There is no notarization because
  it requires a paid Apple Developer account, which this project does not use.
- **Windows:** no Authenticode signature. SmartScreen, Smart App Control or antivirus software may
  warn or block the installer. Verify the SHA-256 checksum published with the release.
- **Linux:** AppImage, deb and rpm are unsigned packages; verify checksums and your distribution's
  package policy.

`0.1.0` publishes Windows builds only; the macOS and Linux entries describe builds the manual
workflow can produce, not downloadable `0.1.0` assets.

Do not disable Gatekeeper or SmartScreen system-wide. If your environment requires a signed build,
build from source and sign it with your own certificate. See [`docs/release.md`](docs/release.md).

## Public status

| Area | Status |
|---|---|
| Contracts (`config.schema.json`, CLI fixtures incl. `stats`) | generated from `lv24-seo 0.5.0`; drift check in CI |
| CI (web, Rust matrix, contract check) | active on pull requests and `main`; standard runners only |
| Manual desktop build workflow (NSIS, DMG, AppImage, deb, rpm) | available; unsigned by default, owner-triggered |
| Tauri command bridge (config read/validate/write/patch, CLI runner, secrets, diagnostics) | implemented |
| React screens (dashboard, settings, configuration, reports, recommendations) | implemented |
| Bundled onedir sidecar | Windows x64 built and SHA-256 pinned; Linux/macOS pins pending |
| Published installers and auto-update | Windows 0.1.0 preview NSIS + portable ZIP; auto-update not initialized |
| `lv24-seo stats --json` engine command | shipped in `lv24-seo 0.5.0`; fixture committed |

The public repository is intentionally honest about the remaining gap: Linux and macOS installers
are not available yet. Follow the
[issues](https://github.com/LevapVeeskela/lv24-seo-optimizer-desktop/issues) for progress, or read
the implementation plan in the engine repository:
[`docs/plans/2026-11-14-seo-desktop.md`](https://github.com/LevapVeeskela/lv24-seo-optimizer/blob/main/docs/plans/2026-11-14-seo-desktop.md).

## Zero-spend policy

The default path uses free tiers only: GitHub-hosted standard runners, PyPI, npm, Tauri's free
updater signing keys (minisign, unused while auto-update is off), SQLite and the user's own provider
credentials. There is no paid CI
runner, no paid code-signing certificate, no notarization, no hosted backend and no telemetry
service. The release workflow is manual and owner-gated. See [`docs/release.md`](docs/release.md).

## Contributing

Bug reports, provider-limit corrections and documentation fixes are welcome. Read
[`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). For security
issues, use [`SECURITY.md`](SECURITY.md).

## License

Apache-2.0. See [`LICENSE`](LICENSE). Provider data belongs to the property owner; this project does
not resell it.
