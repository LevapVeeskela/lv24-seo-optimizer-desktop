# Security model

Status: **security contract for the public scaffold.** The Rust bridge and screens are being
implemented. This page states the controls those components must enforce; it does not claim they are
all present yet. See [`SECURITY.md`](../SECURITY.md) for reporting a vulnerability.

## 1. Assets and adversaries

| Asset | Why it matters |
|---|---|
| Provider credentials (GSC, Yandex, Bing, CrUX, PSI) | grant read access to the property owner's search data |
| SMTP password and Telegram bot token | can send messages and impersonate the owner |
| `seo.toml` | reveals property names, recipients, hosts and paths |
| SQLite history, reports and crawl data | contains queries, URLs and traffic that may be commercially sensitive |
| Updater private key and release artifacts | compromise would ship code to every user |
| Local filesystem | a path traversal or command injection could read or overwrite unrelated files |

Adversaries considered:

- a malicious or compromised webview page or dependency running in the webview;
- a malicious local file or `seo.toml` that tries to escape the workspace;
- a compromised provider response or report HTML;
- a network attacker against provider or update traffic;
- a malicious pull request or dependency in the supply chain;
- a user who is legitimately editing configuration but should not be able to execute arbitrary
  commands from the UI.

Out of scope: a compromised operating system or keychain, a user who intentionally runs a malicious
engine via `LV24_SEO_BIN`, and provider-side breaches.

## 2. Trust boundaries

1. **Webview → Rust.** The webview is untrusted. It can invoke only a fixed command table with
   validated arguments. It cannot pass an executable, a shell string, a raw environment map or a
   path outside the approved roots.
2. **Rust → engine.** The shell launches the exact resolved sidecar with an argv array, an absolute
   `--config`, `--json`, a bounded timeout and `cwd = config parent`. It never uses a shell.
3. **Engine → provider.** The engine owns HTTP, retries, rate limits and write gating. The desktop
   does not proxy provider traffic.
4. **Engine → disk.** The engine writes only to the configured data directory and report output
   paths. The desktop must not silently override `LV24_SEO_DATA_DIR`; doing so would change which
   database a terminal run sees.

## 3. Secrets never enter the webview

- Token input is a password field. The value is sent **once** over IPC and immediately piped to
  `lv24-seo auth set --provider <p> --stdin`.
- The Rust layer zeroizes its buffer after the child exits. The value is never written to a log, a
  MobX store, localStorage, the clipboard, a crash report or a support bundle.
- After saving, the UI shows only presence and source (`keychain`, `env`, `file`, `missing`) from
  `auth status --json`.
- Environment-provided secrets are read-only in the UI. Removing one from the file does not remove
  the environment variable; the UI must say so.
- `seo.toml` never contains tokens, passwords or bot tokens. `config show` is redacted by the
  engine; the desktop must not “unredact” it.
- MCP client installation may return the full merged host configuration, which can contain other
  servers' tokens. The desktop extracts and displays only its own entry and never logs or persists
  the full document.

The engine's own secret sources are documented in
[`docs/configuration.md`](configuration.md#5-secrets). Keychain support requires the engine's
`secrets` extra; without it, the engine falls back to environment variables and an explicitly
opt-in file. The desktop must show which source is active.

## 4. Command execution

- The command table is fixed in Rust. Each entry has an id, a read/write class, an argument schema
  and a timeout.
- Arguments are validated by type, length, enum and allowed characters. Free-form text is passed as
  a single argv element, never interpolated into a command line.
- `--config` must be absolute, canonicalized, and selected through the native dialog (or persisted in
  desktop settings). Canonicalization rejects symlink escapes and control characters; the selected
  project is the consent boundary, not a global directory allow-list.
- `--out` and export paths come from a native folder picker or an approved root; they are
  canonicalized before use.
- Write flags (`--send`, `--allow-write`, confirmation tokens) are never accepted from a read
  command and require an explicit confirmation dialog naming the target.
- Cancellation kills the exact child process handle/PID. It never uses a wildcard process name;
  several LV24 applications can run concurrently.

## 5. Configuration files

- Reads and writes are limited to the approved workspace. The desktop opens the file the engine
  would actually use, not a guessed path.
- Writes are atomic: temp file in the same directory, validation, backup, rename. A failed
  validation leaves the original mtime and contents unchanged.
- Backups are timestamped and capped at five. They inherit restrictive permissions.
- The raw TOML editor is advanced mode. It cannot save unvalidated TOML.
- Environment overrides are displayed as names and status only. The UI explains that the desktop's
  own process environment may differ from a terminal's environment.

## 6. Webview hardening

Production CSP (the scaffold's `src-tauri/tauri.conf.json` is the starting point):

```
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
img-src 'self' asset: http://asset.localhost data:;
style-src 'self' 'unsafe-inline';
font-src 'self';
connect-src ipc: http://ipc.localhost
```

- No remote scripts, styles, fonts, images or connect targets.
- `withGlobalTauri` is false; the UI uses the typed `@tauri-apps/api` imports.
- The development CSP is limited to the Vite origin and is not used in production.
- Report HTML is shown in a sandboxed iframe without scripts or same-origin access. It is rendered
  on a light canvas and never auto-inverted by the dark theme.
- The desktop does not render provider HTML or arbitrary remote content in the main webview.

## 7. Sidecar integrity

- Release builds use a PyInstaller **onedir** tree under the app's resources. Onefile is rejected
  because it extracts on every call and is unsuitable for macOS signing.
- `scripts/build-sidecar.py` pins the engine version and PyInstaller version, uses explicit
  `--collect-submodules`/`--collect-data`/`--add-data` flags and disables UPX.
- `scripts/verify-sidecar.mjs` checks the executable exists, runs `version --json`, requires the
  pinned version and compares SHA-256 with `scripts/cli-checksums.json` when a hash is pinned.
- A placeholder checksum (`null`) is allowed for local development but must be replaced with a
  64-hex SHA-256 before a public release. The release runbook requires this.
- The runtime does not need to re-hash on every launch because the Tauri updater signature covers
  the bundle; the checksum manifest is a build/release control.
- `LV24_SEO_BIN` is a deliberate escape hatch for development and advanced users. Release builds do
  not use it unless the user sets it explicitly, and the UI labels the engine as external.

## 8. Updates

- Auto-update is **disabled** in the committed scaffold: `createUpdaterArtifacts` is `false` and
  there is no updater endpoint or public key. The zero-spend default is a manual install/upgrade.
- If the owner enables it later, Tauri's updater must use Ed25519/minisign signatures. The public
  key belongs in `src-tauri/tauri.conf.json`; the private key is a CI secret and never in the
  repository. `requireSignedVersion` must be enabled, and an update without a valid signature must
  be rejected.
- Enabling the feature requires a deliberate config change; a signing key alone does not turn it on.
- Linux auto-update is supported for AppImage only; deb/rpm are manual upgrades.
- OS code signing/notarization is separate. The default build is unsigned; see section 11.

## 9. No telemetry and diagnostics

- The desktop has no analytics, crash-reporting endpoint or “phone home” call.
- Provider calls are made by the engine, only when the user runs a command.
- The diagnostics bundle is user-triggered and contains versions, paths, doctor checks, redacted
  effective config, environment variable **names**, and recent non-secret job errors. It is never
  uploaded automatically.
- Logs redact secret-looking keys and bounded stderr. Users are told to review a bundle before
  sharing it.

## 10. Write and destructive actions

These require an explicit confirmation naming the target and action:

| Action | Engine behavior |
|---|---|
| Send weekly report | SMTP/Telegram delivery, at-least-once |
| Install scheduler job | writes a host cron/systemd/Task Scheduler entry |
| Install MCP client entry | merges host client configuration |
| Export skills/tools | writes files to a chosen directory |
| IndexNow submit | network write, idempotency ledger |
| Sitemap submit | currently `WRITE_DISABLED` in the engine |
| Yandex recrawl | currently `WRITE_DISABLED` in the engine |

`WRITE_DISABLED` and `CONFIRM_REQUIRED` are shown honestly. The desktop never fakes success, never
retries a write automatically and never turns a disabled engine path into a UI action.

## 11. Unsigned builds

The project does not buy code-signing certificates or notarization:

- **macOS:** ad-hoc signature only (`signingIdentity: "-"`). Gatekeeper warns on first launch; the
  documented flow is System Settings → Privacy & Security → Open Anyway. Do not tell users to
  disable Gatekeeper globally.
- **Windows:** no Authenticode signature. SmartScreen, Smart App Control or antivirus may warn or
  block. Publish SHA-256 checksums and explain how to verify them.
- **Linux:** AppImage/deb/rpm are unsigned packages; checksum verification and distribution policy
  apply.

The release notes and README must state this. A “signed” build is only claimed when the owner has
actually configured a certificate and the workflow produced a verifiable signature. Do not add a
paid certificate, notarization or paid runner without explicit owner approval.

## 12. Supply chain

- CI uses standard GitHub-hosted runners and public-repository free minutes only.
- Dependencies are pinned by `package-lock.json`, `Cargo.lock` and the engine/PyInstaller versions
  in `scripts/cli-checksums.json`.
- Dependabot proposes updates; a human reviews and CI runs on the pull request.
- Contract fixtures are generated from a pinned engine and contain no credentials or customer data.
- `gitleaks` or an equivalent secret scan should run locally and in review; a detected secret is
  rotated, not just deleted from the latest commit.
- Release artifacts are checksum-pinned before publication. The release job is owner-gated and
  manual; there are no push/tag triggers.

## 13. Residual risks

- Provider credentials can be valid but lack permissions; presence is not proof of access.
- HTTP rate limiting in the engine is process-local and cannot guarantee account-wide quotas.
- Delivery is at-least-once, not exactly-once; a crash after remote acceptance can duplicate a
  message.
- A user-supplied `LV24_SEO_BIN` is trusted by definition. The UI labels it, but cannot sandbox it.
- Unsigned builds can be tampered with between download and execution; checksums reduce but do not
  eliminate that risk.
- A compromised OS keychain or a malicious local process with the same user privileges is outside
  the desktop's control.

## 14. Reviewer checklist

- [ ] No secret value can reach the webview, a log, a fixture or a support bundle.
- [ ] Every engine call uses an argv array and an absolute, user-selected config path.
- [ ] No `eval`, shell string, arbitrary executable or unrestricted path.
- [ ] CSP is production-safe; report preview is sandboxed without scripts.
- [ ] Write actions require confirmation and preserve engine `WRITE_DISABLED` semantics.
- [ ] Cancel kills only the exact child process.
- [ ] Sidecar version and checksum are verified before release.
- [ ] Unsigned-build warnings are present in the README and release notes.
- [ ] New dependencies are free-tier compatible and reviewed.
