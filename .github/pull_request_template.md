## Problem

<!-- What is broken or missing? Link the issue. -->

## Solution

<!-- What changed, and why this approach? -->

## Verification

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run contract:check` (if contracts or the engine pin changed)
- [ ] `cd src-tauri && cargo fmt --check`
- [ ] `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- [ ] `cd src-tauri && cargo test`
- [ ] Manual check on Windows / macOS / Linux (state what was checked)

## Screenshots or output

<!-- UI changes: before/after, keyboard focus, 200% zoom. Use synthetic data only. -->

## Safety checklist

- [ ] No secret, token, private key, customer data or private URL is included.
- [ ] No arbitrary command execution, shell string or path escape is introduced.
- [ ] Unknown, capped or delayed provider data is still shown honestly.
- [ ] Write actions still require confirmation and preserve engine gating.
- [ ] The unsigned-build warning remains accurate.
- [ ] This stays within the zero-spend policy (standard runners, free tiers, no paid signing).
- [ ] Docs, fixtures and tests are updated in the same change.

## Provider limits touched

<!-- Which provider, quota, cap or limitation does this affect? "None" if not applicable. -->
