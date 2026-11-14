# Security policy

## Supported versions

`lv24-seo-optimizer-desktop` is **pre-release**. The latest published line is `0.2.0`; `0.1.0` is a
Windows-only preview with no updater and is upgraded manually. Security fixes are provided for the
latest release line; older pre-1.0 lines are not maintained unless stated in the release notes.

The desktop is a shell around the pinned `lv24-seo` engine. A vulnerability in the engine should be
reported to the engine repository as well; this policy covers the desktop shell, scripts, packaging,
updater flow and workflows.

## Reporting a vulnerability

Please use a **private GitHub security advisory**:

<https://github.com/LevapVeeskela/lv24-seo-optimizer-desktop/security/advisories/new>

If advisories are unavailable, email **paulalexeev10@gmail.com** with the subject
`SECURITY: lv24-seo-optimizer-desktop`.

Include:

- the affected version, commit or workflow run;
- the operating system and install method (source build, unsigned installer, development);
- a minimal reproduction and the observed impact;
- whether provider credentials, local files, the updater or the release pipeline are involved;
- any suggested fix or mitigation.

Do **not** publish credentials, customer queries, private site URLs, exploit details or a working
payload in a public issue. If you accidentally expose a token, revoke it with the provider first;
deleting a commit is not enough.

## What to expect

- We aim to acknowledge a report within 5 business days.
- We will confirm the affected versions, reproduce, and agree on a disclosure timeline with you.
- We will credit reporters who want credit, after a fix is available.
- This is a volunteer, zero-spend project. There is no bug bounty and no payment for reports.

## Scope

In scope:

- the Tauri shell, command bridge, path allow-list, config writes and secret handling;
- the React webview, CSP, report preview sandbox and update flow;
- `scripts/build-sidecar.py`, `scripts/verify-sidecar.mjs`, `scripts/gen-contracts.py`,
  `scripts/check-contracts.mjs` and the release/CI workflows;
- the packaged sidecar tree and its version/checksum verification;
- supply-chain issues in this repository's dependencies or release artifacts.

Out of scope:

- vulnerabilities in `lv24-seo` itself (report them to the engine repository; we will coordinate);
- a compromised operating system, keychain, browser/WebView runtime or GitHub account;
- a user intentionally running a malicious binary via `LV24_SEO_BIN`;
- missing OS code signing or notarization (documented, not a vulnerability);
- provider API behavior, quotas or terms of service;
- social engineering, spam or physical access.

## Security model

Read [`docs/security.md`](docs/security.md) for the full model. The essentials:

- **No secrets in the webview.** Token input is sent once over IPC and piped to
  `lv24-seo auth set --stdin`; values are never logged, stored in UI state or included in support
  bundles. On Linux the CLI runner inherits the session-bus/XDG variables Secret Service needs; the
  value still travels only over stdin.
- **No local HTTP API.** The desktop uses a fixed, allow-listed child-process bridge. There is no
  loopback server to authenticate or expose.
- **No telemetry.** Nothing is uploaded automatically except the updater's request for
  `latest.json`; diagnostics are user-triggered and redacted.
- **Read-only by default.** Delivery, scheduler installation, MCP client installation and provider
  write actions require explicit confirmation; `WRITE_DISABLED` is shown honestly.
- **Rebuild-aware sidecar checks.** Release builds verify the engine version and record the actual
  SHA-256 per target; `SHA256SUMS.txt` covers the published assets.
- **Signed updates.** Windows NSIS, macOS `.app` and Linux AppImage verify a minisign signature,
  bind the version to the signed package and refuse downgrades. deb, rpm, MSI and the portable ZIP
  are manual-only.
- **Unsigned OS builds.** The default macOS build is ad-hoc signed, Windows is unsigned and Linux
  packages are unsigned. This is a documented distribution limitation, not a claim of a trusted OS
  signature.

## Secrets and local data

- Use the OS keychain (`lv24-seo[secrets]`) or `LV24_SEO_*` environment variables.
- The opt-in file fallback (`LV24_SEO_ALLOW_FILE_SECRETS=1` + `data/secrets.json`) is for
  headless/keyring-less environments only. On Windows it relies on file ACLs; POSIX `0600` does not
  apply.
- Provider queries, URLs, traffic, SQLite history and reports stay in the configured local storage.
  Provider calls, crawling and opt-in email/Telegram delivery transmit data to those destinations.
- Back up SQLite before upgrading the engine. Do not attach a real workspace database to a public
  issue.

## Release and supply chain

- CI uses public-repository standard runners only; no paid services.
- Dependencies are locked by `package-lock.json`, `Cargo.lock` and the engine/PyInstaller pins in
  `scripts/cli-checksums.json`.
- Release builds are manual and owner-gated; there are no push/tag triggers.
- The updater private key (`TAURI_SIGNING_PRIVATE_KEY`) is a repository secret, passed only to the
  build step and never committed, logged or shipped. The public key is in
  `src-tauri/tauri.conf.json`.
- The updater endpoint is
  `https://github.com/LevapVeeskela/lv24-seo-optimizer-desktop/releases/latest/download/latest.json`.
  `requireSignedVersion` is enabled; a signature failure blocks the update and downgrades are
  refused.
- The release is created as a draft, assets are uploaded and verified, `latest.json` is uploaded
  last, and only then is the release undrafted. A draft is not visible through `releases/latest`.
- Release assets are published with `SHA256SUMS.txt`, covering installers, updater packages,
  signatures and `latest.json`; verify it before installing.

## Update security

- Windows NSIS, macOS `.app` and Linux AppImage use the Tauri updater with a minisign/Ed25519 key.
  The public key is embedded; the private key is a build-step secret.
- `requireSignedVersion` binds the announced version to the signed package. The updater refuses a
  version that is not greater than the running one, so it cannot downgrade.
- The updater never installs without an explicit user action. An unsaved configuration draft
  disables the install button.
- deb, rpm, MSI and the portable ZIP are manual-only. The UI disables in-app installation and links
  to the release page instead of pretending the package can replace itself.
- `0.1.0` has no updater. Install `0.2.0` manually once; auto-update works from `0.2.0` onward.
- A signature failure blocks the artifact and points to the release page. It is not treated as an
  offline error and the same artifact is not retried.

## Unsigned builds

macOS builds are ad-hoc signed only; Gatekeeper will warn. Windows builds have no Authenticode
signature; SmartScreen or antivirus may warn. Linux packages are unsigned. Do not disable Gatekeeper
or SmartScreen system-wide. If your threat model requires a signed build, build from source and sign
it with your own certificate.

## Safe harbor

We will not pursue legal action for good-faith security research that stays within this policy,
avoids privacy violations and data destruction, and gives us a reasonable time to fix the issue
before public disclosure. Do not test against systems or accounts you do not own or have permission
to test.
