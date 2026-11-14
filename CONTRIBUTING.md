# Contributing

Thanks for helping. This project is a public, zero-spend desktop shell around `lv24-seo`. Clear,
boring, well-tested changes win over clever ones.

## Quick start

```bash
git clone https://github.com/LevapVeeskela/lv24-seo-optimizer-desktop
cd lv24-seo-optimizer-desktop
npm ci
npm run check
```

Desktop shell and sidecar work additionally needs Rust stable, Python 3.12 and
[`uv`](https://docs.astral.sh/uv/). Install the platform prerequisites from the
[Tauri v2 guide](https://v2.tauri.app/start/prerequisites/).

```bash
npm run tauri dev
python scripts/build-sidecar.py --engine-version 0.5.2
node scripts/check-contracts.mjs
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

## What we accept

- Documentation fixes, especially where provider limits or desktop behavior are described
  imprecisely.
- UI, accessibility, i18n (`en`, `ru`, `zh`) and error/empty-state improvements.
- Rust bridge tests: path allow-list, atomic config writes, argv construction, envelope parsing,
  secret stdin and exact-process cancellation.
- Contract fixtures and parser tests for a new pinned engine version.
- Packaging fixes for Windows, macOS and Linux that stay on free standard runners.
- Free-tier provider support inherited from the engine, with the limits documented.

## What we do not accept

- Paid-only services, paid CI runners, paid code-signing certificates or notarization in the
  default path.
- A local HTTP API without an explicit design and security review.
- Shell strings, arbitrary executables or path escapes from the webview.
- Secrets, real customer data, private site URLs or provider tokens in code, fixtures, logs or
  screenshots.
- SERP scraping or quota-bypass logic.
- Silent truncation, zero-filled unknowns or fake progress percentages.
- Claims that an unsigned build is signed.

## Workflow

1. Open an issue using the templates. Security issues go through [`SECURITY.md`](SECURITY.md).
2. Branch from `main`: `feat/<area>-<short-name>` or `fix/<area>-<short-name>`.
3. Keep one area per commit. Subject format:
   `[SEO](<area>) - <what changed>`.
   Areas: `ui`, `shell`, `contracts`, `docs`, `infra`, `tests`, `packaging`.
4. Add tests for the failure mode, not only the happy path. UI changes include a keyboard/a11y
   check. Contract changes include regenerated fixtures.
5. Run the relevant checks:
   ```bash
   npm run check
   npm run contract:check
   cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
   ```
6. Open a pull request using the template. Include problem, solution, verification commands,
   screenshots for UI changes, and any provider limits or engine-contract changes.

## Contracts

- `contracts/config.schema.json` and `contracts/cli-v1/*.json` are generated from the pinned
  `lv24-seo`; never hand-edit them.
- Change the pin in `scripts/cli-checksums.json` and run `node scripts/check-contracts.mjs --update`.
- `contracts/stats-v1.md` documents the shipped `lv24-seo stats --json` shape. Keep its fixture
  in sync when the engine changes the command.
- Fixtures must be synthetic, deterministic and free of secrets, personal data and real queries.

## Sidecar

- Build with `scripts/build-sidecar.py`; do not commit `src-tauri/engine/` or `build-info.json`.
- Release builds use onedir, not onefile.
- Pin real SHA-256 values in `scripts/cli-checksums.json` before a public release.
- Verify with `node scripts/verify-sidecar.mjs --require-pinned` after a build.

## Zero-spend and release policy

- GitHub Actions uses public-repository standard runners only. Do not add larger runners, paid
  minutes, paid storage, paid signing or paid third-party services.
- The desktop workflow is manual (`workflow_dispatch`) and owner-gated. Do not add push, tag or
  release triggers that spend minutes unexpectedly.
- Artifact retention is 7 days.
- Keep hard budgets and overage blocking enabled. A green local build is not proof that a remote
  pipeline ran.

## Commit and review checklist

- [ ] The change is in one area and has a focused commit message.
- [ ] No secret, token, private key or real customer data is added.
- [ ] No arbitrary command execution or path escape is introduced.
- [ ] Unknown/truncated provider data is still shown honestly.
- [ ] Write actions require confirmation and preserve engine gating.
- [ ] Tests and docs are updated in the same change.
- [ ] Windows, macOS and Linux behavior is considered.
- [ ] The unsigned-build warning remains accurate.

## License

By contributing you agree your work is licensed under Apache-2.0 (inbound = outbound).
