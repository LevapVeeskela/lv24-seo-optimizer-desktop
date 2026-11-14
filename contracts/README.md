# Contracts

This directory is the machine-readable boundary between the desktop and the pinned `lv24-seo`
engine. The desktop must not guess at engine fields; a contract change is reviewed and regenerated.

## Files

| Path | Status | Source |
|---|---|---|
| `config.schema.json` | generated | `SeoConfig.model_json_schema()` from the pinned engine |
| `cli-v1/*.json` | generated | normalized `--json` envelopes from the pinned CLI |
| `cli-v1/manifest.json` | generated | commands, exit codes, engine pin and fixture list |
| `stats-v1.md` | hand-written contract note | `lv24-seo stats --json` shape, shipped by 0.5.1 |
| `cli-v1/stats.json` | generated | normalized `stats` envelope from the pinned CLI |

`stats-v1.md` explains the stats fields; the machine-readable fixture is generated like every other
CLI contract. When the pin changes, review the regenerated `stats.json` together with the note.

## Pin

The engine, Python, pydantic, typer and PyInstaller versions live in
[`../scripts/cli-checksums.json`](../scripts/cli-checksums.json). The contract generator refuses to
run when the installed engine version differs from that pin.

Changing the pin is a deliberate change:

1. review the engine release notes and its own contract changes;
2. update `version` in `scripts/cli-checksums.json`;
3. run `node scripts/check-contracts.mjs --update`;
4. review every changed fixture and the schema diff;
5. update the desktop parser/tests if a field changed;
6. commit the pin and the regenerated contracts together.

## Generate and check

```bash
# Regenerate in place (writes config.schema.json and cli-v1/*.json)
node scripts/check-contracts.mjs --update

# Check for drift (the CI mode)
node scripts/check-contracts.mjs

# Static checks only, without installing the pinned engine
node scripts/check-contracts.mjs --static
```

`check-contracts.mjs` runs `gen-contracts.py` through `uv` with the pinned `lv24-seo`, `pydantic`
and `typer` versions. `gen-contracts.py` can also be run directly with an installed engine:

```bash
python scripts/gen-contracts.py --check
python scripts/gen-contracts.py --write
```

## Fixtures

The generator uses a temporary, isolated workspace with no provider credentials and no user config.
It records:

- `version`
- `config show` (no config)
- `doctor` (no config)
- `properties`
- `auth status`
- `stats` (no configured providers)
- `report weekly` (no-data fallback)
- `report diff` (no-store error envelope)

The stats fixture is generated from the same isolated workspace as the others: every provider is
`not_configured`, which is the honest baseline. Configured-provider values are exercised by the
engine's own tests, not by committing private data here.

Each fixture is a raw envelope. `manifest.json` records the command, expected exit code and file
name. The generator normalizes volatile values:

- timestamps → `<TIMESTAMP>`;
- dates → `<DATE>`;
- temporary paths and the home directory → `<WORKSPACE>` / `<HOME>`;
- `duration_ms` → `0`;
- doctor's Python/platform/cwd/token details → stable placeholders.

Do not add real tokens, customer queries, private URLs or personal paths. A fixture must be
reproducible on Windows, macOS and Linux from the same pinned engine.

## Schema

`config.schema.json` is generated from Pydantic. The generator adds a stable `$id` and a `$comment`
naming the engine version; the rest is the engine's schema. The desktop validates drafts against the
engine itself (`config show --config <temp> --json`) because the CLI also enforces semantic rules
that a JSON schema cannot express.

## Drift policy

- Generated files are never hand-edited.
- A failing contract check means the desktop and engine disagree. Fix the parser or regenerate with
  a reviewed pin; do not silence the check.
- Additive fields are tolerated by the parser, but they still appear in a regenerated fixture and
  require a reviewed commit.
- Removing or renaming a field, changing its type/nullability, or changing an error code is a
  breaking contract change. Document it and bump the desktop version accordingly.
