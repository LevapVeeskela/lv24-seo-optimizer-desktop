# Security policy

## Supported versions

`lv24-seo-optimizer-desktop` is **pre-release**. There is no published installer yet, so there is no
supported production version. After the first public release, security fixes are provided for the
latest release line; older pre-1.0 lines are not maintained unless stated in the release notes.

The desktop is a shell around the pinned `lv24-seo` engine. A vulnerability in the engine should be
reported to the engine repository as well; this policy covers the desktop shell, scripts, packaging
and workflows.

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
  bundles.
- **No local HTTP API.** The desktop uses a fixed, allow-listed child-process bridge. There is no
  loopback server to authenticate or expose.
- **No telemetry.** Nothing is uploaded automatically.
- **Read-only by default.** Delivery, scheduler installation, MCP client installation and provider
  write actions require explicit confirmation; `WRITE_DISABLED` is shown honestly.
- **Checksum-pinned sidecar.** Release builds verify the engine version and SHA-256 before
  publication.
- **Unsigned builds.** The default macOS build is ad-hoc signed and Windows is unsigned. This is a
  documented distribution limitation, not a claim of a trusted signature.

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
- The updater private key is a repository secret and is never committed. The public key is in
  `src-tauri/tauri.conf.json`.
- Release assets are published with `SHA256SUMS.txt`; verify it before installing.

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
