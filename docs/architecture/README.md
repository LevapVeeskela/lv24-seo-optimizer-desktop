# Architecture diagrams

Mermaid sources live next to the generated files. Edit the `.mmd`, re-render with
`lv24-diagram render <file.mmd> --saved "<title>"`, and commit the `.svg`/`.png` with it. Do not
hand-edit generated files.

| # | Diagram | Source | Rendered | What it shows |
|---|---|---|---|---|
| 01 | Trust boundary | [.mmd](01-trust-boundary.mmd) | [.svg](01-trust-boundary.svg) · [.png](01-trust-boundary.png) | Untrusted webview, authorized Rust shell, engine child process and provider calls. |
| 02 | Engine resolution | [.mmd](02-engine-resolution.mmd) | [.svg](02-engine-resolution.svg) · [.png](02-engine-resolution.png) | Candidate order and the `MIN_ENGINE_VERSION` gate before any command runs. |
| 03 | Update pipeline | [.mmd](03-update-pipeline.mmd) | [.svg](03-update-pipeline.svg) · [.png](03-update-pipeline.png) | Manifest check, user confirmation, Rust verification/install and failure block. |

Updated 2026-11-27.
