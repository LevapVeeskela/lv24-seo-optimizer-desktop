# Configuration

Status: **desktop configuration contract for `0.9.6` (current release, 2026-11-18; `0.9.4` is the
previous published line).** The
settings screens implement this contract; the engine-side `seo.toml` semantics below are those of the
pinned `lv24-seo 0.15.1`. When the desktop and the engine disagree, the engine is authoritative and the
desktop must show its validation error instead of silently “fixing” the file. The desktop's
`ConfigModel` mirrors the subset of `lv24_seo.core.config.SeoConfig` used by the forms for `0.15.1`;
the engine still validates the whole file.

## 1. What owns what

| Setting | Owner | Where |
|---|---|---|
| Project, providers, reports, delivery, crawl, storage | `lv24-seo` | `seo.toml` |
| Provider tokens, SMTP password, Telegram bot token | OS keychain / environment / opt-in file | never `seo.toml` |
| UI language, theme, last workspace, window state | desktop | Tauri app-config directory |
| Report language | `lv24-seo` | `report.locale` in `seo.toml` |

The desktop does not add a second project model. It edits the same `seo.toml` a terminal user would
edit, and it shows the effective result from `lv24-seo config show --json`.

## 2. Resolution and precedence

The engine resolves configuration in this order:

1. CLI flags (`--config`, command-specific options); an explicit path must exist;
2. `LV24_SEO_*` environment variables;
3. `./seo.toml` in the current working directory;
4. the platform user config file returned by `platformdirs.user_config_dir("lv24-seo")`:
   `%LOCALAPPDATA%\lv24-seo\lv24-seo\config.toml` on Windows,
   `~/Library/Application Support/lv24-seo/config.toml` on macOS, and
   `$XDG_CONFIG_HOME/lv24-seo/config.toml` or `~/.config/lv24-seo/config.toml` on Linux;
5. built-in defaults.

The Windows path really does contain `lv24-seo` twice: `platformdirs` uses the app name as the
default author segment when no author is passed. Do not “correct” it by hand; let the engine resolve
it. The desktop always passes an absolute `--config`, so this path matters mainly for terminal runs
and for finding an existing file to select.

`.env` files are **not** loaded automatically. Use `--env-file .env` explicitly or export the
variables.

The desktop always passes an absolute `--config` path and launches the engine with
`cwd = config parent`. This keeps a relative `storage.data_dir` stable. The desktop does not set
`LV24_SEO_DATA_DIR` silently, because that would override the file and make terminal and desktop
runs use different databases.

## 3. Workspace layout

A workspace is a directory containing `seo.toml` and (usually) a `data/` directory:

```
my-seo-workspace/
  seo.toml
  data/
    seo.sqlite3
    reports/
```

The desktop asks you to select an existing `seo.toml` from Settings or Configuration; there is no
separate onboarding wizard and the desktop does not silently create a project file. To create a new
workspace, run the engine command shown in the empty state and then select the file:

```bash
lv24-seo init --property https://example.com --data-dir ./data
```

The desktop reads the file back through the engine. Its own preferences are separate and never
contain provider secrets.

## 4. `seo.toml` reference

```toml
[project]
name = "example.com"
base_url = "https://example.com"
default_property = "sc-domain:example.com"

[providers.gsc]
property = "sc-domain:example.com"
# Reserved label; credentials come from the secret store, not this file.
auth = "keychain"

[providers.yandex_webmaster]
host_id = "https:example.com:443"

[providers.yandex_metrika]
counter = "123456"
goals = [1, 2]                 # parsed but unused today

[providers.bing]
site = "https://example.com"
# indexnow_key = "abc12345"                         # public identifier, not a secret
# indexnow_key_location = "https://example.com/abc12345.txt"  # optional; defaults to https://<host>/<key>.txt

[providers.crux]
origin = "https://example.com"

[providers.psi]
strategy = "mobile"            # mobile | desktop
urls = ["https://example.com/", "https://example.com/pricing"]

[report]
locale = "ru"                  # ru | en | zh; rendered text only
timezone = "Europe/Minsk"
week_start = "monday"          # reserved; no effect on report windows
thresholds = { clicks_pct = 10, impressions_pct = 15, position_abs = 1.5 }

[report.email]
enabled = true
to = ["owner@example.com"]
from = "seo@example.com"
only_on_change = true
smtp_host = "smtp.example.com"
smtp_port = 587
smtp_user = "seo@example.com"
# The SMTP password is stored in the secret store, never here.

[report.telegram]
enabled = true
chat_id = "123456789"
severity = "critical"          # parsed but unused by delivery today

[crawl]
max_urls = 500
concurrency = 4                # reserved; the crawler is serial
respect_robots = true
user_agent = "lv24-seo/0.1 (+https://example.com/bot)"

[storage]
data_dir = "./data"
raw_retention_days = 90        # reserved; no raw archives are written
```

### Project

| Key | Meaning | Validation |
|---|---|---|
| `project.name` | display name | free text |
| `project.base_url` | canonical site URL | absolute `http(s)` URL |
| `project.default_property` | GSC property id or default target | string |

### Providers

| Provider | Target keys | Notes |
|---|---|---|
| `providers.gsc` | `property`, reserved `auth` | OAuth access token today; service-account flow is planned |
| `providers.yandex_webmaster` | `host_id` | Yandex OAuth |
| `providers.yandex_metrika` | `counter`, `goals` | separate `metrika` auth provider (`yandex_metrika_token`); `goals` is parsed but unused |
| `providers.bing` | `site`, `indexnow_key`, `indexnow_key_location` | Bing Webmaster API key is a secret; the IndexNow key and location are public and live in `seo.toml` |
| `providers.crux` | `origin` | CrUX API key |
| `providers.psi` | `strategy`, `urls` | PSI API key; lab data, first URL for aggregate metrics |

A provider card is **configured** when its target is present and **ready** when the target and
required credential are present. Presence is not proof of permission; “Test” calls
`lv24-seo properties --json`, which checks configuration and secret presence, not a live API call.

### Report and delivery

- `report.locale` is the single source of truth for the rendered language of the weekly email,
  Telegram message, CLI human summary and HTML written by `report weekly --out`. JSON envelopes,
  MCP payloads, stored snapshots, `report diff` and `report.json` stay canonical English.
- There are no `report.email.locale` or `report.telegram.locale` keys. Set `report.locale` once.
- `only_on_change = true` skips a period whose semantic content hash was already sent. A locale
  change re-sends the same period once; rebuilding in the same language does not.
- `thresholds` controls when a delta is called significant. The desktop displays the threshold next
  to the comparison; it must not invent its own significance rule.
- `smtp_port = 587` uses STARTTLS with certificate validation before login. There is no “ignore
  certificate” switch.
- Telegram sends plain text (no `parse_mode`) and treats Bot API errors as failures.

### Crawl and storage

- `crawl.max_urls` bounds the crawl; `respect_robots = true` is the safe default.
- `crawl.concurrency` is reserved and has no effect; the crawler is serial with `Crawl-delay`
  pacing. The UI shows it as “no effect”.
- `storage.data_dir` is anchored to the config file since `lv24-seo 0.5.2`: a relative value written
  in `seo.toml` resolves against the config file's parent, so a run from another working directory
  cannot create a second database. The built-in default (no `[storage]` block) and
  `LV24_SEO_DATA_DIR` stay process-scoped. `doctor --json` reports `meta.data_dir` and
  `meta.data_dir_source` (`config` or `working directory`). The desktop still launches with
  `cwd = config parent`.
- `storage.raw_retention_days` is reserved; no raw provider archives are written, so pruning is a
  logged no-op. The UI must not imply that changing it deletes data.
- `data/seo.sqlite3` is the history. Back it up before upgrading the engine.

### Reserved or no-effect fields

| Field | Status |
|---|---|
| `providers.gsc.auth` | reserved label; credentials come from the secret store |
| `providers.yandex_metrika.goals` | parsed but unused |
| `report.week_start` | reserved; report windows use the compare period |
| `report.telegram.severity` | parsed but unused by delivery |
| `crawl.concurrency` | reserved; the crawler is serial |
| `storage.raw_retention_days` | ignored; no raw archives are written |

The desktop labels each of these **no effect** and does not present it as a working control.

## 5. Secrets

| Source | How it works | Desktop behavior |
|---|---|---|
| OS keychain | `lv24-seo auth set --provider <p> --stdin` with the `secrets` extra | preferred; show “keychain” |
| Environment | `LV24_SEO_*` variables | read-only badge; values never shown |
| Opt-in file | `LV24_SEO_ALLOW_FILE_SECRETS=1` + `<data-dir>/secrets.json` (0600 on POSIX) | show a warning; never copy the file |
| Missing | no credential | show `missing`, not an outage |

Rules:

- The desktop and the CLI share one OS keychain entry per secret: service `lv24-seo`, username
  equal to the secret name (`gsc_token`, `yandex_webmaster_token`, `yandex_metrika_token`,
  `bing_api_key`, `crux_api_key`, `psi_api_key`, `smtp_password`, `telegram_bot_token`). A token
  entered in either surface is visible to the other; nothing is copied into the webview or the app
  data directory.
- The opt-in `<data-dir>/secrets.json` fallback is shared only when both surfaces use the same
  workspace/data directory. On POSIX it is `0600`; on Windows it relies on file ACLs.
- No token, SMTP password or bot token belongs in `seo.toml`, a report, a fixture, a log or a
  diagnostics summary.
- `auth status --json` reports provider, secret name, presence, source and optional expiry; never
  the value.
- On Windows, file fallback relies on directory/file ACLs; POSIX `0600` cannot enforce Windows
  permissions. Prefer the keychain.
- On Linux the desktop's CLI runner inherits the session-bus and XDG runtime variables Secret
  Service needs (`DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`, `TMPDIR` and related paths). The
  secret value itself is still sent only over stdin; it is never passed as an argument.
- Removing an environment-provided secret from the file does not remove the variable. The UI must
  explain this.

## 6. Environment variables

All engine variables are prefixed `LV24_SEO_`. The main ones:

| Variable | Purpose |
|---|---|
| `LV24_SEO_GSC_TOKEN` | GSC OAuth access token; the service-account flow is planned |
| `LV24_SEO_GSC_PROPERTY` | GSC property override |
| `LV24_SEO_YANDEX_WEBMASTER_TOKEN`, `LV24_SEO_YANDEX_HOST_ID` | Yandex Webmaster |
| `LV24_SEO_YANDEX_METRIKA_TOKEN`, `LV24_SEO_YANDEX_METRIKA_COUNTER` | Yandex Metrika (separate token) |
| `LV24_SEO_BING_API_KEY` | Bing Webmaster API key; IndexNow reads `providers.bing.indexnow_key`/`indexnow_key_location` (or `--key`) |
| `LV24_SEO_CRUX_API_KEY`, `LV24_SEO_PSI_API_KEY` | CrUX / PSI |
| `LV24_SEO_SMTP_HOST`, `LV24_SEO_SMTP_PORT`, `LV24_SEO_SMTP_USER`, `LV24_SEO_SMTP_PASSWORD`, `LV24_SEO_SMTP_FROM`, `LV24_SEO_MAIL_TO` | email delivery |
| `LV24_SEO_TELEGRAM_BOT_TOKEN`, `LV24_SEO_TELEGRAM_CHAT_ID` | Telegram delivery |
| `LV24_SEO_REPORT_LOCALE`, `LV24_SEO_REPORT_TIMEZONE` | `report.locale` / `report.timezone` override |
| `LV24_SEO_DATA_DIR` | storage override; the desktop does not set it silently |
| `LV24_SEO_LOG_LEVEL` | engine log level |
| `LV24_SEO_ALLOW_FILE_SECRETS` | set to `1` only for headless/keyring-less environments |
| `LV24_SEO_BIN` | desktop-only: absolute path to an external engine |

The desktop shows the names of detected variables and whether they override the file. It does not
display values and does not copy the process environment into logs.

## 7. Desktop preferences

The desktop-only preferences are stored in the Tauri app-config directory for
`by.lv24.seo.desktop`. They include UI language (`en`, `ru`, `zh`), theme, last workspace and window
state. They never contain provider secrets, report content or SQLite data.

The UI language and `report.locale` are independent:

- UI language changes menus, labels and validation text.
- `report.locale` changes the language of the weekly report and delivery.
- Machine codes (`metric`, `severity`, `engine`, `kind`, `status`, `reason`) are never translated.

## 8. Configuration outputs

The **Settings** screen is the editable form. The **Configuration** screen is read-only and exposes
seven tabs:

1. **Overview** — config path, resolved path, data directory, engine version, last load/validation,
   backups and a copyable diagnostics summary.
2. **Effective** — `lv24-seo config show --json`; `meta.redacted = true`; copy.
3. **Source TOML** — the file as stored on disk, comments preserved, secret-looking values redacted;
   read-only.
4. **Diff** — saved vs draft, field-level; destructive changes highlighted.
5. **Validation** — TOML syntax, schema errors, unknown keys and reserved fields.
6. **Doctor** — the read-only engine environment checks and warnings.
7. **Environment** — variable names, override status and secret source; no values.

There is no raw TOML editor and no “advanced mode” that writes the file directly. Edits go through
the Settings form. The relevant outputs have copy buttons and a “Reveal file” action restricted by
the path allow-list. The page never shows token values, SMTP passwords or bot tokens.

## 9. Save and validation

1. TOML syntax is checked locally (line/column).
2. The draft is validated by the engine with
   `lv24-seo config show --config <temp> --json`; unknown keys are rejected.
3. Semantic warnings are shown: no provider target, email enabled without recipients/host, Telegram
   enabled without chat, enabled channel with a missing secret, missing/unwritable data dir,
   invalid timezone, empty PSI list, locale-switch resend, reserved fields changed.
4. Save applies field-level `config_patch` operations through `toml_edit`, so comments, key order
   and unrelated formatting survive. The shell revalidates, creates `<seo.toml>.bak-<timestamp>`
   (last five kept), and atomically replaces the file.
5. If the file changed externally, reload before saving so the form reflects the current file. The
   diff tab shows the saved-vs-draft fields before a save.

A failed validation leaves the original file untouched. A parse error blocks the form save and names
the line and column; the Source TOML tab remains available read-only.

## 10. Common commands

```bash
lv24-seo init --property https://example.com --data-dir ./data
lv24-seo config show --json
lv24-seo config show --config ./seo.toml --json
lv24-seo properties --json
lv24-seo auth status --json
lv24-seo auth set --provider gsc --stdin
lv24-seo doctor --json
```

The desktop calls the same commands with an absolute `--config` and parses the envelope. See
[`docs/architecture.md`](architecture.md#4-command-bridge) for the bridge contract.

## 11. Troubleshooting

| Symptom | Likely cause | What the desktop shows |
|---|---|---|
| `CONFIG_INVALID` on save | unknown key, bad URL, invalid locale/timezone | field-level error; original file untouched |
| Provider card says `missing_token` | no keychain/env/file credential | configuration hint, not an outage |
| `no_data` | provider reachable but no rows for the window | neutral empty state with data age |
| `truncated: true` | provider row cap | warning; totals are not presented as complete |
| report is a no-data fallback | no provider rows | neutral report, `complete: false` |
| engine version mismatch | sidecar and desktop pins disagree | engine marked offline with the standard notice; footer shows the detected engine version when available; no blocking dialog |
| relative data dir differs from terminal | `LV24_SEO_DATA_DIR` or the built-in default is process-scoped | `doctor --json` `meta.data_dir_source`; a file-written relative `data_dir` is anchored to the config since engine `0.5.2` |
