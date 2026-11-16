use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::paths::{
    validate_absolute_path, validate_backup_archive_path, validate_config_path,
    validate_directory_path, validate_init_config_path, validate_init_data_dir,
    validate_log_file_path, EngineLocation,
};

/// Upper bounds keep a runaway engine from exhausting webview memory.
const MAX_STDOUT: usize = 4 * 1024 * 1024;
const MAX_STDERR: usize = 128 * 1024;

const DEFAULT_DAYS: u32 = 7;
const DEFAULT_LAG_DAYS: u32 = 2;

/// Insight commands (logs/tasks) share one bounded input contract.
const LOG_BOTS: &[&str] = &["googlebot", "yandexbot", "bingbot", "other"];
const TASK_STATES: &[&str] = &["open", "in_progress", "verified", "dismissed"];
const MAX_TASK_KIND_LEN: usize = 64;
const MAX_TASK_RULE_LEN: usize = 256;
const MAX_TASK_URL_LEN: usize = 2048;
const MAX_TASK_PROPERTY_LEN: usize = 512;
const MAX_TASK_PAYLOAD_BYTES: usize = 16 * 1024;
const MAX_TASKS_LIMIT: u32 = 500;
/// `portfolio list` returns a bounded roll-up; the shell keeps the same cap.
const MAX_PORTFOLIO_LIMIT: u32 = 50;
/// A confirm token is `<expiry>:<hmac>`; keep the charset narrow so nothing
/// but the token itself can reach argv.
const MAX_CONFIRM_TOKEN_LEN: usize = 512;

/// How long `stop_tracked_children` waits for killed sidecars to disappear
/// before the update is refused.
pub const ENGINE_STOP_WAIT: Duration = Duration::from_millis(2_000);
const ENGINE_STOP_POLL: Duration = Duration::from_millis(25);
/// How long a delivered SIGKILL may take to actually remove the process.
#[cfg(unix)]
const ENGINE_KILL_WAIT: Duration = Duration::from_millis(2_000);

/// Every command the webview may run. There is no generic executable input.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CliCommandId {
    Version,
    Stats,
    ConfigShow,
    Doctor,
    Properties,
    AuthStatus,
    ReportWeekly,
    ReportDiff,
    Crawl,
    /// Onboarding: writes a new `seo.toml` and its data directory.
    Init,
    /// Render a scheduler artefact (cron/systemd/windows); never installs it.
    SchedulePrint,
    /// Analyze one approved local access log; read-only.
    LogsAnalyze,
    /// Local finding/task lifecycle (schema v3).
    TasksList,
    TasksAdd,
    TasksUpdate,
    /// Portable local backup zip; writes only the chosen directory.
    BackupCreate,
    /// Two-phase restore of a backup zip; plan without a token, apply with one.
    BackupRestore,
    /// Read-only multi-site roll-up over local project databases.
    PortfolioList,
    /// Install the weekly/daily report job in the host scheduler.
    ScheduleInstall,
    /// Internal commands used by dedicated auth commands; they are deliberately
    /// absent from the generic `cli_run` allow-list.
    AuthSet,
    AuthLogout,
}

/// How a command changes state. `init` writes local files only; no command in
/// the allow-list spends provider quota or changes remote provider state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WriteKind {
    /// Read-only: no file or provider state changes.
    None,
    /// Creates local files under a user-approved directory (`init`).
    LocalState,
}

impl CliCommandId {
    pub fn parse(raw: &str) -> AppResult<Self> {
        match raw.trim() {
            "version" => Ok(Self::Version),
            "stats" => Ok(Self::Stats),
            "config_show" => Ok(Self::ConfigShow),
            "doctor" => Ok(Self::Doctor),
            "properties" => Ok(Self::Properties),
            "auth_status" => Ok(Self::AuthStatus),
            "report_weekly" => Ok(Self::ReportWeekly),
            "report_diff" => Ok(Self::ReportDiff),
            "crawl" => Ok(Self::Crawl),
            "init" => Ok(Self::Init),
            "schedule_print" => Ok(Self::SchedulePrint),
            "logs_analyze" => Ok(Self::LogsAnalyze),
            "tasks_list" => Ok(Self::TasksList),
            "tasks_add" => Ok(Self::TasksAdd),
            "tasks_update" => Ok(Self::TasksUpdate),
            "backup_create" => Ok(Self::BackupCreate),
            "backup_restore" => Ok(Self::BackupRestore),
            "portfolio_list" => Ok(Self::PortfolioList),
            "schedule_install" => Ok(Self::ScheduleInstall),
            other => Err(AppError::new(
                "INVALID_COMMAND",
                format!("command {other:?} is not in the desktop allow-list"),
            )
            .with_details(serde_json::json!({
                "allowed": [
                    "version", "stats", "config_show", "doctor", "properties",
                    "auth_status", "report_weekly", "report_diff", "crawl",
                    "init", "schedule_print", "logs_analyze", "tasks_list",
                    "tasks_add", "tasks_update", "backup_create", "backup_restore",
                    "portfolio_list", "schedule_install"
                ]
            }))),
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Version => "version",
            Self::Stats => "stats",
            Self::ConfigShow => "config_show",
            Self::Doctor => "doctor",
            Self::Properties => "properties",
            Self::AuthStatus => "auth_status",
            Self::ReportWeekly => "report_weekly",
            Self::ReportDiff => "report_diff",
            Self::Crawl => "crawl",
            Self::Init => "init",
            Self::SchedulePrint => "schedule_print",
            Self::LogsAnalyze => "logs_analyze",
            Self::TasksList => "tasks_list",
            Self::TasksAdd => "tasks_add",
            Self::TasksUpdate => "tasks_update",
            Self::BackupCreate => "backup_create",
            Self::BackupRestore => "backup_restore",
            Self::PortfolioList => "portfolio_list",
            Self::ScheduleInstall => "schedule_install",
            Self::AuthSet => "auth_set",
            Self::AuthLogout => "auth_delete",
        }
    }

    /// Commands that need an existing project config file. `version`, `stats`,
    /// `doctor`, `properties`, `auth_status`, `init`, `logs_analyze` and
    /// `portfolio_list` may run without one; `auth_set` and `auth_delete` are
    /// reached through their dedicated commands.
    pub fn requires_config(self) -> bool {
        matches!(
            self,
            Self::ConfigShow
                | Self::ReportWeekly
                | Self::ReportDiff
                | Self::Crawl
                | Self::SchedulePrint
                | Self::ScheduleInstall
                | Self::TasksList
                | Self::TasksAdd
                | Self::TasksUpdate
                | Self::BackupCreate
                | Self::BackupRestore
        )
    }

    /// How the command changes state. `init`, the task lifecycle, backups and
    /// the host scheduler write local state only; no command in the allow-list
    /// spends provider quota or changes remote provider state.
    pub fn write_kind(self) -> WriteKind {
        match self {
            Self::Init
            | Self::TasksAdd
            | Self::TasksUpdate
            | Self::BackupCreate
            | Self::BackupRestore
            | Self::ScheduleInstall => WriteKind::LocalState,
            _ => WriteKind::None,
        }
    }

    pub fn timeout(self) -> Duration {
        match self {
            Self::Crawl => Duration::from_secs(600),
            Self::AuthSet | Self::AuthLogout => Duration::from_secs(120),
            // A restore copies a whole database and may replace large files.
            Self::BackupRestore => Duration::from_secs(300),
            Self::Stats | Self::ReportWeekly | Self::ReportDiff | Self::BackupCreate => {
                Duration::from_secs(120)
            }
            // Onboarding may create a directory tree on a slow disk.
            Self::Init => Duration::from_secs(60),
            // A cold PyInstaller sidecar can spend well over ten seconds on
            // unpacking and antivirus scanning before it prints a version.
            Self::Version => Duration::from_secs(30),
            Self::LogsAnalyze
            | Self::TasksList
            | Self::TasksAdd
            | Self::TasksUpdate
            | Self::PortfolioList
            | Self::ScheduleInstall => Duration::from_secs(60),
            Self::ConfigShow
            | Self::Doctor
            | Self::Properties
            | Self::AuthStatus
            | Self::SchedulePrint => Duration::from_secs(30),
        }
    }

    /// Commands whose UI may expose a Cancel button. Only long local jobs are
    /// listed: a short read stays a synchronous call with no run banner, and a
    /// command absent from this list rejects a webview-supplied run id.
    ///
    /// `backup_restore` is cancellable in both phases. Cancelling the apply
    /// phase stops the engine mid-replace; the engine keeps a pre-restore copy,
    /// and the UI says the restore may need to be reviewed again.
    pub fn cancellable(self) -> bool {
        matches!(
            self,
            Self::Crawl
                | Self::ReportWeekly
                | Self::LogsAnalyze
                | Self::BackupCreate
                | Self::BackupRestore
                | Self::ScheduleInstall
        )
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct CliArgs {
    pub days: Option<u32>,
    pub lag_days: Option<u32>,
    pub base: Option<String>,
    pub head: Option<String>,
    pub start: Option<String>,
    pub max_urls: Option<u32>,
    /// Report output directory. Only `report_weekly` accepts it; the shell
    /// resolves the default and checks that any webview value stays under the
    /// app export directory.
    pub out: Option<String>,
    /// Used only by the dedicated auth commands; never contains a secret.
    pub provider: Option<String>,
    /// `init` only: site URL or GSC property (`sc-domain:example.com`).
    pub property: Option<String>,
    /// `init` (creates it) and `schedule_print` (reads it): absolute config.
    pub config_path: Option<String>,
    /// `init` only: absolute data directory the engine creates.
    pub data_dir: Option<String>,
    /// `schedule_print` only: five-field cron expression.
    pub cron: Option<String>,
    /// `schedule_print` only: `cron`, `systemd` or `windows`.
    pub target: Option<String>,
    /// `logs_analyze` only: absolute regular access log, approved by the native
    /// dialog or located under the app data/export directories.
    pub file: Option<String>,
    /// `logs_analyze` only: `googlebot`, `yandexbot`, `bingbot`, `other` or
    /// empty (no bot filter).
    pub bot: Option<String>,
    /// `tasks_list`/`tasks_add` only: task kind filter or the kind to create.
    pub kind: Option<String>,
    /// `tasks_list`/`tasks_update` only: lifecycle state.
    pub state: Option<String>,
    /// `tasks_list` only: 1..=500 rows.
    pub limit: Option<u32>,
    /// `tasks_add` only: affected URL (absolute or site-relative).
    pub url: Option<String>,
    /// `tasks_add` only: rule/finding id that produced the task.
    pub rule: Option<String>,
    /// `tasks_add` only: evidence object, encoded as compact JSON (16 KiB cap).
    pub payload: Option<Value>,
    /// `tasks_update` only: positive task id.
    pub id: Option<i64>,
    /// `backup_create` only: replace a same-second archive.
    pub force: Option<bool>,
    /// `backup_restore` apply phase and `schedule_install` write opt-in. The
    /// plan/preview phases must not set it.
    pub allow_write: Option<bool>,
    /// `backup_restore` only: `confirm_token` returned by the plan phase.
    pub confirm: Option<String>,
    /// `portfolio_list` only: absolute directory picked in the native dialog.
    pub root: Option<String>,
}

impl CliArgs {
    /// Fields owned by `init`/`schedule_print`. Every other command rejects
    /// them instead of silently ignoring a path or a schedule.
    fn has_init_or_schedule_args(&self) -> bool {
        self.property.is_some()
            || self.config_path.is_some()
            || self.data_dir.is_some()
            || self.cron.is_some()
            || self.target.is_some()
    }

    fn has_schedule_args(&self) -> bool {
        self.config_path.is_some()
            || self.data_dir.is_some()
            || self.cron.is_some()
            || self.target.is_some()
    }

    fn has_report_args(&self) -> bool {
        self.days.is_some()
            || self.lag_days.is_some()
            || self.base.is_some()
            || self.head.is_some()
            || self.start.is_some()
            || self.max_urls.is_some()
            || self.out.is_some()
            || self.provider.is_some()
    }

    fn has_log_or_task_args(&self) -> bool {
        self.file.is_some()
            || self.bot.is_some()
            || self.kind.is_some()
            || self.state.is_some()
            || self.limit.is_some()
            || self.url.is_some()
            || self.rule.is_some()
            || self.payload.is_some()
            || self.id.is_some()
            || self.force.is_some()
    }

    /// Write-gate arguments that only `backup_restore` accepts.
    fn has_restore_args(&self) -> bool {
        self.allow_write.is_some() || self.confirm.is_some()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliRunResult {
    pub command: String,
    pub exit_code: Option<i32>,
    pub envelope: Value,
    pub stderr: String,
    pub duration_ms: u64,
    pub truncated: bool,
    /// `true` for a command that only writes local files (`init`); provider
    /// quota and remote state are untouched.
    pub writes_local_state: bool,
}

pub const AUTH_PROVIDERS: &[&str] = &[
    "gsc", "yandex", "metrika", "bing", "crux", "psi", "smtp", "telegram",
];

pub fn normalize_auth_provider(raw: &str) -> AppResult<String> {
    let value = raw.trim().to_ascii_lowercase();
    if AUTH_PROVIDERS.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("provider {raw:?} is not supported for auth"),
        )
        .with_details(serde_json::json!({ "allowed": AUTH_PROVIDERS })))
    }
}

/// Build the exact argv for an allow-listed command. `--json` is always
/// present; `--config` is appended by [`build_command`].
pub fn build_argv(command: CliCommandId, args: &CliArgs) -> AppResult<Vec<String>> {
    validate_args(command, args)?;
    let days = args.days.unwrap_or(DEFAULT_DAYS).to_string();
    let lag_days = args.lag_days.unwrap_or(DEFAULT_LAG_DAYS).to_string();

    let argv = match command {
        CliCommandId::Version => vec!["version".into(), "--json".into()],
        CliCommandId::Stats => vec![
            "stats".into(),
            "--days".into(),
            days,
            "--lag-days".into(),
            lag_days,
            "--json".into(),
        ],
        CliCommandId::ConfigShow => vec!["config".into(), "show".into(), "--json".into()],
        CliCommandId::Doctor => vec!["doctor".into(), "--json".into()],
        CliCommandId::Properties => vec!["properties".into(), "--json".into()],
        CliCommandId::AuthStatus => {
            vec!["auth".into(), "status".into(), "--json".into()]
        }
        CliCommandId::ReportWeekly => {
            let mut argv = vec![
                "report".into(),
                "weekly".into(),
                "--days".into(),
                days,
                "--lag-days".into(),
                lag_days,
            ];
            if let Some(out) = args.out.as_deref() {
                argv.push("--out".into());
                argv.push(
                    validate_absolute_path(out, "report output")?
                        .display()
                        .to_string(),
                );
            }
            argv.push("--json".into());
            argv
        }
        CliCommandId::ReportDiff => {
            let mut argv = vec!["report".into(), "diff".into()];
            if let Some(base) = args.base.as_deref() {
                argv.push("--base".into());
                argv.push(validate_period(base, "base")?.to_string());
            }
            if let Some(head) = args.head.as_deref() {
                argv.push("--head".into());
                argv.push(validate_period(head, "head")?.to_string());
            }
            argv.push("--json".into());
            argv
        }
        CliCommandId::Crawl => {
            let mut argv = vec!["crawl".into()];
            if let Some(start) = args.start.as_deref() {
                argv.push("--start".into());
                argv.push(validate_url(start)?.to_string());
            }
            if let Some(max_urls) = args.max_urls {
                argv.push("--max-urls".into());
                argv.push(max_urls.to_string());
            }
            argv.push("--json".into());
            argv
        }
        CliCommandId::AuthSet => {
            let provider = normalize_auth_provider(args.provider.as_deref().unwrap_or(""))?;
            vec![
                "auth".into(),
                "set".into(),
                "--provider".into(),
                provider,
                "--stdin".into(),
                "--json".into(),
            ]
        }
        CliCommandId::AuthLogout => {
            let provider = normalize_auth_provider(args.provider.as_deref().unwrap_or(""))?;
            vec![
                "auth".into(),
                "logout".into(),
                "--provider".into(),
                provider,
                "--json".into(),
            ]
        }
        CliCommandId::Init => {
            let property = validate_property(args.property.as_deref().unwrap_or(""))?;
            let config = validate_init_config_path(args.config_path.as_deref().unwrap_or(""))?;
            let data_dir = validate_init_data_dir(args.data_dir.as_deref().unwrap_or(""))?;
            vec![
                "init".into(),
                "--property".into(),
                property,
                "--config".into(),
                config.display().to_string(),
                "--data-dir".into(),
                data_dir.display().to_string(),
                "--json".into(),
            ]
        }
        CliCommandId::SchedulePrint => {
            let cron = normalize_cron(args.cron.as_deref().unwrap_or(""))?;
            let target = normalize_schedule_target(args.target.as_deref().unwrap_or(""))?;
            let mut argv = vec![
                "schedule".into(),
                "print".into(),
                "--cron".into(),
                cron,
                "--target".into(),
                target,
            ];
            if let Some(config) = args.config_path.as_deref() {
                argv.push("--config".into());
                argv.push(validate_config_path(config)?.display().to_string());
            }
            argv.push("--json".into());
            argv
        }
        CliCommandId::LogsAnalyze => {
            let file = validate_log_file_path(args.file.as_deref().unwrap_or(""), "log file")?;
            let mut argv = vec![
                "logs".into(),
                "analyze".into(),
                "--file".into(),
                file.display().to_string(),
            ];
            if let Some(bot) = normalize_log_bot(args.bot.as_deref())? {
                argv.push("--bot".into());
                argv.push(bot);
            }
            argv.push("--json".into());
            argv
        }
        CliCommandId::TasksList => {
            let mut argv = vec!["tasks".into(), "list".into()];
            if let Some(property) = args.property.as_deref() {
                argv.push("--property".into());
                argv.push(validate_task_property(property)?);
            }
            if let Some(kind) = args.kind.as_deref() {
                argv.push("--kind".into());
                argv.push(validate_task_kind(kind)?);
            }
            if let Some(state) = args.state.as_deref() {
                argv.push("--state".into());
                argv.push(normalize_task_state(state)?);
            }
            if let Some(limit) = args.limit {
                validate_range(limit, 1, MAX_TASKS_LIMIT, "limit")?;
                argv.push("--limit".into());
                argv.push(limit.to_string());
            }
            argv.push("--json".into());
            argv
        }
        CliCommandId::TasksAdd => {
            let kind = validate_task_kind(args.kind.as_deref().unwrap_or(""))?;
            let url = validate_task_url(args.url.as_deref().unwrap_or(""))?;
            let rule = validate_task_rule(args.rule.as_deref().unwrap_or(""))?;
            let mut argv = vec![
                "tasks".into(),
                "add".into(),
                "--kind".into(),
                kind,
                "--url".into(),
                url,
                "--rule".into(),
                rule,
            ];
            if let Some(property) = args.property.as_deref() {
                argv.push("--property".into());
                argv.push(validate_task_property(property)?);
            }
            if let Some(payload) = args.payload.as_ref() {
                argv.push("--payload".into());
                argv.push(encode_task_payload(payload)?);
            }
            argv.push("--json".into());
            argv
        }
        CliCommandId::TasksUpdate => {
            let id = args.id.filter(|value| *value > 0).ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "id must be a positive integer")
            })?;
            let state = normalize_task_state(args.state.as_deref().unwrap_or(""))?;
            vec![
                "tasks".into(),
                "update".into(),
                id.to_string(),
                "--state".into(),
                state,
                "--json".into(),
            ]
        }
        CliCommandId::BackupCreate => {
            let out = validate_absolute_path(args.out.as_deref().unwrap_or(""), "backup output")?;
            if !out.is_dir() {
                return Err(AppError::new(
                    "INVALID_PATH",
                    format!("backup output is not a directory: {}", out.display()),
                ));
            }
            let mut argv = vec![
                "backup".into(),
                "create".into(),
                "--out".into(),
                out.display().to_string(),
            ];
            if args.force == Some(true) {
                argv.push("--force".into());
            }
            argv.push("--json".into());
            argv
        }
        CliCommandId::BackupRestore => {
            let file = validate_backup_archive_path(args.file.as_deref().unwrap_or(""))?;
            let config = validate_config_path(args.config_path.as_deref().unwrap_or(""))?;
            let mut argv = vec![
                "backup".into(),
                "restore".into(),
                "--file".into(),
                file.display().to_string(),
                "--config".into(),
                config.display().to_string(),
            ];
            if args.allow_write == Some(true) {
                argv.push("--allow-write".into());
            }
            if let Some(token) = args.confirm.as_deref() {
                argv.push("--confirm".into());
                argv.push(validate_confirm_token(token)?);
            }
            argv.push("--json".into());
            argv
        }
        CliCommandId::PortfolioList => {
            let root =
                validate_directory_path(args.root.as_deref().unwrap_or(""), "portfolio root")?;
            let mut argv = vec![
                "portfolio".into(),
                "list".into(),
                "--root".into(),
                root.display().to_string(),
            ];
            if let Some(limit) = args.limit {
                validate_range(limit, 1, MAX_PORTFOLIO_LIMIT, "limit")?;
                argv.push("--limit".into());
                argv.push(limit.to_string());
            }
            argv.push("--json".into());
            argv
        }
        CliCommandId::ScheduleInstall => {
            let kind = normalize_schedule_kind(args.kind.as_deref().unwrap_or(""))?;
            let config = validate_config_path(args.config_path.as_deref().unwrap_or(""))?;
            let mut argv = vec!["schedule".into(), "install".into(), "--kind".into(), kind];
            if let Some(cron) = args.cron.as_deref() {
                argv.push("--cron".into());
                argv.push(normalize_cron(cron)?);
            }
            argv.push("--config".into());
            argv.push(config.display().to_string());
            // The engine plans by default and touches the host scheduler only
            // with this opt-in. `validate_args` requires it, and the only UI
            // path that sets it is the confirmation dialog.
            argv.push("--allow-write".into());
            argv.push("--json".into());
            argv
        }
    };
    Ok(argv)
}

fn validate_args(command: CliCommandId, args: &CliArgs) -> AppResult<()> {
    let reject = |field: &str| -> AppResult<()> {
        Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("{field} is not accepted by {}", command.id()),
        ))
    };

    match command {
        CliCommandId::Stats => {
            if args.base.is_some()
                || args.head.is_some()
                || args.start.is_some()
                || args.max_urls.is_some()
                || args.provider.is_some()
                || args.out.is_some()
                || args.has_init_or_schedule_args()
                || args.has_log_or_task_args()
                || args.has_restore_args()
                || args.root.is_some()
            {
                return reject("base/head/start/maxUrls/provider/out/init/schedule");
            }
            validate_range(args.days.unwrap_or(DEFAULT_DAYS), 1, 365, "days")?;
            validate_range(args.lag_days.unwrap_or(DEFAULT_LAG_DAYS), 0, 30, "lagDays")?;
        }
        CliCommandId::ReportWeekly => {
            if args.base.is_some()
                || args.head.is_some()
                || args.start.is_some()
                || args.max_urls.is_some()
                || args.provider.is_some()
                || args.has_init_or_schedule_args()
                || args.has_log_or_task_args()
                || args.has_restore_args()
                || args.root.is_some()
            {
                return reject("base/head/start/maxUrls/provider/init/schedule");
            }
            validate_range(args.days.unwrap_or(DEFAULT_DAYS), 1, 365, "days")?;
            validate_range(args.lag_days.unwrap_or(DEFAULT_LAG_DAYS), 0, 30, "lagDays")?;
            if let Some(out) = args.out.as_deref() {
                validate_absolute_path(out, "report output")?;
            }
        }
        CliCommandId::ReportDiff => {
            if args.days.is_some()
                || args.lag_days.is_some()
                || args.start.is_some()
                || args.max_urls.is_some()
                || args.provider.is_some()
                || args.out.is_some()
                || args.has_init_or_schedule_args()
                || args.has_log_or_task_args()
                || args.has_restore_args()
                || args.root.is_some()
            {
                return reject("days/lagDays/start/maxUrls/provider/out/init/schedule");
            }
            if let Some(base) = args.base.as_deref() {
                validate_period(base, "base")?;
            }
            if let Some(head) = args.head.as_deref() {
                validate_period(head, "head")?;
            }
        }
        CliCommandId::Crawl => {
            if args.days.is_some()
                || args.lag_days.is_some()
                || args.base.is_some()
                || args.head.is_some()
                || args.provider.is_some()
                || args.out.is_some()
                || args.has_init_or_schedule_args()
                || args.has_log_or_task_args()
                || args.has_restore_args()
                || args.root.is_some()
            {
                return reject("days/lagDays/base/head/provider/out/init/schedule");
            }
            if let Some(start) = args.start.as_deref() {
                validate_url(start)?;
            }
            if let Some(max_urls) = args.max_urls {
                validate_range(max_urls, 1, 10_000, "maxUrls")?;
            }
        }
        CliCommandId::Version
        | CliCommandId::ConfigShow
        | CliCommandId::Doctor
        | CliCommandId::Properties
        | CliCommandId::AuthStatus => {
            if args.days.is_some()
                || args.lag_days.is_some()
                || args.base.is_some()
                || args.head.is_some()
                || args.start.is_some()
                || args.max_urls.is_some()
                || args.out.is_some()
                || args.provider.is_some()
                || args.has_init_or_schedule_args()
                || args.has_log_or_task_args()
                || args.has_restore_args()
                || args.root.is_some()
            {
                return reject("all arguments");
            }
        }
        CliCommandId::AuthSet | CliCommandId::AuthLogout => {
            if args.days.is_some()
                || args.lag_days.is_some()
                || args.base.is_some()
                || args.head.is_some()
                || args.start.is_some()
                || args.max_urls.is_some()
                || args.out.is_some()
                || args.has_init_or_schedule_args()
                || args.has_log_or_task_args()
                || args.has_restore_args()
                || args.root.is_some()
            {
                return reject("days/lagDays/base/head/start/maxUrls/out/init/schedule");
            }
            if args.provider.is_none() {
                return Err(AppError::new(
                    "INVALID_ARGUMENT",
                    "provider is required for auth commands",
                ));
            }
        }
        CliCommandId::Init => {
            if args.days.is_some()
                || args.lag_days.is_some()
                || args.base.is_some()
                || args.head.is_some()
                || args.start.is_some()
                || args.max_urls.is_some()
                || args.out.is_some()
                || args.provider.is_some()
                || args.cron.is_some()
                || args.target.is_some()
                || args.has_log_or_task_args()
                || args.has_restore_args()
                || args.root.is_some()
            {
                return reject("an argument other than property/configPath/dataDir");
            }
            let property = args.property.as_deref().ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "property is required for init")
            })?;
            validate_property(property)?;
            let config = args.config_path.as_deref().ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "configPath is required for init")
            })?;
            validate_init_config_path(config)?;
            let data_dir = args
                .data_dir
                .as_deref()
                .ok_or_else(|| AppError::new("INVALID_ARGUMENT", "dataDir is required for init"))?;
            validate_init_data_dir(data_dir)?;
        }
        CliCommandId::SchedulePrint => {
            if args.days.is_some()
                || args.lag_days.is_some()
                || args.base.is_some()
                || args.head.is_some()
                || args.start.is_some()
                || args.max_urls.is_some()
                || args.out.is_some()
                || args.provider.is_some()
                || args.property.is_some()
                || args.data_dir.is_some()
                || args.has_log_or_task_args()
                || args.has_restore_args()
                || args.root.is_some()
            {
                return reject(
                    "days/lagDays/base/head/start/maxUrls/out/provider/property/dataDir",
                );
            }
            let cron = args.cron.as_deref().ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "cron is required for schedule_print")
            })?;
            normalize_cron(cron)?;
            let target = args.target.as_deref().ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "target is required for schedule_print")
            })?;
            normalize_schedule_target(target)?;
            if let Some(config) = args.config_path.as_deref() {
                validate_config_path(config)?;
            }
        }
        CliCommandId::LogsAnalyze => {
            if args.has_report_args()
                || args.has_init_or_schedule_args()
                || args.kind.is_some()
                || args.state.is_some()
                || args.limit.is_some()
                || args.url.is_some()
                || args.rule.is_some()
                || args.payload.is_some()
                || args.id.is_some()
                || args.force.is_some()
                || args.has_restore_args()
                || args.root.is_some()
            {
                return reject("an argument other than file/bot");
            }
            let file = args.file.as_deref().ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "file is required for logs_analyze")
            })?;
            validate_log_file_path(file, "log file")?;
            normalize_log_bot(args.bot.as_deref())?;
        }
        CliCommandId::TasksList => {
            if args.has_report_args()
                || args.has_schedule_args()
                || args.file.is_some()
                || args.bot.is_some()
                || args.url.is_some()
                || args.rule.is_some()
                || args.payload.is_some()
                || args.id.is_some()
                || args.force.is_some()
                || args.has_restore_args()
                || args.root.is_some()
            {
                return reject("an argument other than property/kind/state/limit");
            }
            if let Some(property) = args.property.as_deref() {
                validate_task_property(property)?;
            }
            if let Some(kind) = args.kind.as_deref() {
                validate_task_kind(kind)?;
            }
            if let Some(state) = args.state.as_deref() {
                normalize_task_state(state)?;
            }
            if let Some(limit) = args.limit {
                validate_range(limit, 1, MAX_TASKS_LIMIT, "limit")?;
            }
        }
        CliCommandId::TasksAdd => {
            if args.has_report_args()
                || args.has_schedule_args()
                || args.file.is_some()
                || args.bot.is_some()
                || args.state.is_some()
                || args.limit.is_some()
                || args.id.is_some()
                || args.force.is_some()
                || args.has_restore_args()
                || args.root.is_some()
            {
                return reject("an argument other than kind/url/rule/property/payload");
            }
            let kind = args.kind.as_deref().ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "kind is required for tasks_add")
            })?;
            validate_task_kind(kind)?;
            let url = args.url.as_deref().ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "url is required for tasks_add")
            })?;
            validate_task_url(url)?;
            let rule = args.rule.as_deref().ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "rule is required for tasks_add")
            })?;
            validate_task_rule(rule)?;
            if let Some(property) = args.property.as_deref() {
                validate_task_property(property)?;
            }
            if let Some(payload) = args.payload.as_ref() {
                encode_task_payload(payload)?;
            }
        }
        CliCommandId::TasksUpdate => {
            if args.has_report_args()
                || args.has_init_or_schedule_args()
                || args.file.is_some()
                || args.bot.is_some()
                || args.kind.is_some()
                || args.limit.is_some()
                || args.url.is_some()
                || args.rule.is_some()
                || args.payload.is_some()
                || args.force.is_some()
                || args.has_restore_args()
                || args.root.is_some()
            {
                return reject("an argument other than id/state");
            }
            if args.id.is_none_or(|value| value <= 0) {
                return Err(AppError::new(
                    "INVALID_ARGUMENT",
                    "id must be a positive integer",
                ));
            }
            let state = args.state.as_deref().ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "state is required for tasks_update")
            })?;
            normalize_task_state(state)?;
        }
        CliCommandId::BackupCreate => {
            if args.days.is_some()
                || args.lag_days.is_some()
                || args.base.is_some()
                || args.head.is_some()
                || args.start.is_some()
                || args.max_urls.is_some()
                || args.provider.is_some()
                || args.has_init_or_schedule_args()
                || args.file.is_some()
                || args.bot.is_some()
                || args.kind.is_some()
                || args.state.is_some()
                || args.limit.is_some()
                || args.url.is_some()
                || args.rule.is_some()
                || args.payload.is_some()
                || args.id.is_some()
                || args.has_restore_args()
                || args.root.is_some()
            {
                return reject("an argument other than out/force");
            }
            let out = args.out.as_deref().ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "out is required for backup_create")
            })?;
            let path = validate_absolute_path(out, "backup output")?;
            if !path.is_dir() {
                return Err(AppError::new(
                    "INVALID_PATH",
                    format!("backup output is not a directory: {}", path.display()),
                ));
            }
        }
        CliCommandId::BackupRestore => {
            if args.days.is_some()
                || args.lag_days.is_some()
                || args.base.is_some()
                || args.head.is_some()
                || args.start.is_some()
                || args.max_urls.is_some()
                || args.out.is_some()
                || args.provider.is_some()
                || args.property.is_some()
                || args.data_dir.is_some()
                || args.cron.is_some()
                || args.target.is_some()
                || args.bot.is_some()
                || args.kind.is_some()
                || args.state.is_some()
                || args.limit.is_some()
                || args.url.is_some()
                || args.rule.is_some()
                || args.payload.is_some()
                || args.id.is_some()
                || args.force.is_some()
                || args.root.is_some()
            {
                return reject("an argument other than file/configPath/allowWrite/confirm");
            }
            let file = args.file.as_deref().ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "file is required for backup_restore")
            })?;
            validate_backup_archive_path(file)?;
            let config = args.config_path.as_deref().ok_or_else(|| {
                AppError::new(
                    "INVALID_ARGUMENT",
                    "configPath is required for backup_restore",
                )
            })?;
            validate_config_path(config)?;
            // The plan is the only phase without a token; a token without the
            // explicit opt-in would ask the engine to apply without consent.
            if args.confirm.is_some() && args.allow_write != Some(true) {
                return Err(AppError::new(
                    "INVALID_ARGUMENT",
                    "confirm requires allowWrite=true",
                ));
            }
            if let Some(token) = args.confirm.as_deref() {
                validate_confirm_token(token)?;
            }
        }
        CliCommandId::PortfolioList => {
            if args.days.is_some()
                || args.lag_days.is_some()
                || args.base.is_some()
                || args.head.is_some()
                || args.start.is_some()
                || args.max_urls.is_some()
                || args.out.is_some()
                || args.provider.is_some()
                || args.property.is_some()
                || args.data_dir.is_some()
                || args.config_path.is_some()
                || args.cron.is_some()
                || args.target.is_some()
                || args.file.is_some()
                || args.bot.is_some()
                || args.kind.is_some()
                || args.state.is_some()
                || args.url.is_some()
                || args.rule.is_some()
                || args.payload.is_some()
                || args.id.is_some()
                || args.force.is_some()
                || args.has_restore_args()
            {
                return reject("an argument other than root/limit");
            }
            let root = args.root.as_deref().ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "root is required for portfolio_list")
            })?;
            validate_directory_path(root, "portfolio root")?;
            if let Some(limit) = args.limit {
                validate_range(limit, 1, MAX_PORTFOLIO_LIMIT, "limit")?;
            }
        }
        CliCommandId::ScheduleInstall => {
            if args.days.is_some()
                || args.lag_days.is_some()
                || args.base.is_some()
                || args.head.is_some()
                || args.start.is_some()
                || args.max_urls.is_some()
                || args.out.is_some()
                || args.provider.is_some()
                || args.property.is_some()
                || args.data_dir.is_some()
                || args.target.is_some()
                || args.file.is_some()
                || args.bot.is_some()
                || args.state.is_some()
                || args.limit.is_some()
                || args.url.is_some()
                || args.rule.is_some()
                || args.payload.is_some()
                || args.id.is_some()
                || args.force.is_some()
                || args.confirm.is_some()
                || args.root.is_some()
            {
                return reject("an argument other than kind/cron/configPath/allowWrite");
            }
            let kind = args.kind.as_deref().ok_or_else(|| {
                AppError::new("INVALID_ARGUMENT", "kind is required for schedule_install")
            })?;
            normalize_schedule_kind(kind)?;
            if let Some(cron) = args.cron.as_deref() {
                normalize_cron(cron)?;
            }
            let config = args.config_path.as_deref().ok_or_else(|| {
                AppError::new(
                    "INVALID_ARGUMENT",
                    "configPath is required for schedule_install",
                )
            })?;
            validate_config_path(config)?;
            // The engine plans by default. A host write happens only when the
            // user confirmed the dialog and the webview set this opt-in.
            if args.allow_write != Some(true) {
                return Err(AppError::new(
                    "CONFIRM_REQUIRED",
                    "schedule_install writes a host job; pass allowWrite=true only after the user confirms",
                )
                .with_details(serde_json::json!({
                    "command": "schedule_install",
                    "requires": "allowWrite",
                })));
            }
        }
    }
    Ok(())
}

fn validate_range(value: u32, min: u32, max: u32, label: &str) -> AppResult<()> {
    if value < min || value > max {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("{label} must be between {min} and {max}, got {value}"),
        ));
    }
    Ok(())
}

fn validate_period<'a>(value: &'a str, label: &str) -> AppResult<&'a str> {
    let (start, end) = value.split_once("..").ok_or_else(|| {
        AppError::new(
            "INVALID_ARGUMENT",
            format!("{label} must be START..END, got {value:?}"),
        )
    })?;
    if !is_iso_date(start) || !is_iso_date(end) || start > end {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("{label} must be a valid YYYY-MM-DD..YYYY-MM-DD range, got {value:?}"),
        ));
    }
    Ok(value)
}

fn is_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let parse = |slice: &str| slice.parse::<u32>().ok();
    let (Some(year), Some(month), Some(day)) = (
        parse(&value[0..4]),
        parse(&value[5..7]),
        parse(&value[8..10]),
    ) else {
        return false;
    };
    if year < 1970 || !(1..=12).contains(&month) {
        return false;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

fn validate_url(value: &str) -> AppResult<&str> {
    validate_http_url(value, "start URL")
}

fn validate_http_url<'a>(value: &'a str, label: &str) -> AppResult<&'a str> {
    let trimmed = value.trim();
    if trimmed.len() > MAX_TASK_URL_LEN {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("{label} is longer than {MAX_TASK_URL_LEN} characters"),
        ));
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("{label} must not contain whitespace or control characters"),
        ));
    }
    let rest = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .ok_or_else(|| {
            AppError::new(
                "INVALID_ARGUMENT",
                format!("{label} must use http or https, got {trimmed:?}"),
            )
        })?;
    let authority = rest.split('/').next().unwrap_or("");
    if authority.is_empty()
        || authority.starts_with(':')
        || authority.contains('@')
        || authority.contains('?')
        || authority.contains('#')
        || authority.contains('\\')
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("{label} has an invalid host: {trimmed:?}"),
        ));
    }
    Ok(trimmed)
}

fn normalize_log_bot(raw: Option<&str>) -> AppResult<Option<String>> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let value = raw.trim().to_ascii_lowercase();
    if value.is_empty() {
        return Ok(None);
    }
    if LOG_BOTS.contains(&value.as_str()) {
        Ok(Some(value))
    } else {
        Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("bot {raw:?} is not supported for logs_analyze"),
        )
        .with_details(serde_json::json!({ "allowed": LOG_BOTS })))
    }
}

fn normalize_task_state(raw: &str) -> AppResult<String> {
    let value = raw.trim().to_ascii_lowercase();
    if TASK_STATES.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("state {raw:?} is not a task lifecycle state"),
        )
        .with_details(serde_json::json!({ "allowed": TASK_STATES })))
    }
}

fn validate_task_kind(raw: &str) -> AppResult<String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err(AppError::new("INVALID_ARGUMENT", "kind is empty"));
    }
    if value.len() > MAX_TASK_KIND_LEN {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("kind is longer than {MAX_TASK_KIND_LEN} characters"),
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "kind must not contain control characters",
        ));
    }
    Ok(value.to_string())
}

fn validate_task_rule(raw: &str) -> AppResult<String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err(AppError::new("INVALID_ARGUMENT", "rule is empty"));
    }
    if value.len() > MAX_TASK_RULE_LEN {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("rule is longer than {MAX_TASK_RULE_LEN} characters"),
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "rule must not contain control characters",
        ));
    }
    Ok(value.to_string())
}

/// `tasks add --url` accepts an absolute http(s) URL or a site-relative path,
/// which is how crawl findings are recorded.
fn validate_task_url(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new("INVALID_ARGUMENT", "url is empty"));
    }
    if trimmed.len() > MAX_TASK_URL_LEN {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("url is longer than {MAX_TASK_URL_LEN} characters"),
        ));
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "url must not contain whitespace or control characters",
        ));
    }
    if trimmed.starts_with('/') && !trimmed.starts_with("//") {
        return Ok(trimmed.to_string());
    }
    validate_http_url(trimmed, "task URL").map(str::to_string)
}

fn validate_task_property(raw: &str) -> AppResult<String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err(AppError::new("INVALID_ARGUMENT", "property is empty"));
    }
    if value.len() > MAX_TASK_PROPERTY_LEN {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("property is longer than {MAX_TASK_PROPERTY_LEN} characters"),
        ));
    }
    if value
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "property must not contain whitespace or control characters",
        ));
    }
    Ok(value.to_string())
}

/// The engine parses `--payload` as a JSON object and rejects credential-shaped
/// keys itself. The shell bounds the encoded size so a runaway webview cannot
/// push an arbitrarily large argv.
fn encode_task_payload(value: &Value) -> AppResult<String> {
    if !value.is_object() {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "payload must be a JSON object",
        ));
    }
    let encoded = serde_json::to_string(value).map_err(|err| {
        AppError::new(
            "INVALID_ARGUMENT",
            format!("payload cannot be encoded as JSON: {err}"),
        )
    })?;
    if encoded.len() > MAX_TASK_PAYLOAD_BYTES {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("payload is larger than {MAX_TASK_PAYLOAD_BYTES} bytes"),
        )
        .with_details(serde_json::json!({ "maxBytes": MAX_TASK_PAYLOAD_BYTES })));
    }
    Ok(encoded)
}

/// Five-field cron expressions are the only shape all three scheduler targets
/// understand. The shell checks length and charset (no shell metacharacters, no
/// newlines); semantic ranges stay with the engine, which reports them with its
/// typed envelope.
const MAX_CRON_LEN: usize = 128;
const SCHEDULE_TARGETS: &[&str] = &["cron", "systemd", "windows"];

fn normalize_cron(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new("INVALID_ARGUMENT", "cron is empty"));
    }
    if trimmed.len() > MAX_CRON_LEN {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("cron is longer than {MAX_CRON_LEN} characters"),
        ));
    }
    if trimmed
        .chars()
        .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '\t' | '*' | ',' | '-' | '/')))
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "cron may only contain letters, digits, spaces and * , - /",
        ));
    }
    let fields: Vec<&str> = trimmed.split_whitespace().collect();
    if fields.len() != 5 {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("cron must have 5 fields, got {}", fields.len()),
        ));
    }
    Ok(fields.join(" "))
}

fn normalize_schedule_target(raw: &str) -> AppResult<String> {
    let value = raw.trim().to_ascii_lowercase();
    if SCHEDULE_TARGETS.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("schedule target {raw:?} is not supported"),
        )
        .with_details(serde_json::json!({ "allowed": SCHEDULE_TARGETS })))
    }
}

/// `schedule install` supports exactly the two report kinds the engine ships.
const SCHEDULE_KINDS: &[&str] = &["weekly", "daily"];

fn normalize_schedule_kind(raw: &str) -> AppResult<String> {
    let value = raw.trim().to_ascii_lowercase();
    if SCHEDULE_KINDS.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("schedule kind {raw:?} is not supported"),
        )
        .with_details(serde_json::json!({ "allowed": SCHEDULE_KINDS })))
    }
}

/// The engine mints `<expiry>:<hmac>`; the shell only checks that the value is
/// a bounded token and cannot smuggle whitespace, control characters or an
/// option prefix into argv.
fn validate_confirm_token(raw: &str) -> AppResult<String> {
    if raw.is_empty() {
        return Err(AppError::new("INVALID_ARGUMENT", "confirm token is empty"));
    }
    if raw.len() > MAX_CONFIRM_TOKEN_LEN {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("confirm token is longer than {MAX_CONFIRM_TOKEN_LEN} characters"),
        ));
    }
    if raw.starts_with('-') {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "confirm token must not start with '-'",
        ));
    }
    if !raw
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, ':' | '.' | '_' | '-'))
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "confirm token contains characters outside [A-Za-z0-9:._-]",
        ));
    }
    Ok(raw.to_string())
}

/// The `init` property is a site URL, a `sc-domain:` GSC property, or a bare
/// host. It is normalized to the form the engine writes into `seo.toml`.
fn validate_property(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "property is empty; pass a site URL or sc-domain: property",
        ));
    }
    if trimmed.len() > 2048 {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "property is longer than 2048 characters",
        ));
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "property must not contain whitespace or control characters",
        ));
    }
    if let Some(host) = trimmed.strip_prefix("sc-domain:") {
        let host = host.trim_end_matches('/');
        if !is_host_like(host) {
            return Err(AppError::new(
                "INVALID_ARGUMENT",
                format!("sc-domain property has an invalid host: {trimmed:?}"),
            ));
        }
        return Ok(format!("sc-domain:{}", host.to_ascii_lowercase()));
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        validate_url(trimmed)?;
        return Ok(trimmed.to_string());
    }
    let host = trimmed.trim_end_matches('/');
    if !is_host_like(host) {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("property must be a URL or a host, got {trimmed:?}"),
        ));
    }
    Ok(format!("https://{}", host.to_ascii_lowercase()))
}

fn is_host_like(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && !host.starts_with('.')
        && !host.starts_with('-')
        && !host.starts_with(':')
        && !host.ends_with('.')
        && !host.ends_with('-')
        && !host.ends_with(':')
        && host
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ':'))
}

fn build_command(
    location: &EngineLocation,
    config_path: Option<&Path>,
    argv: &[String],
) -> AppResult<Command> {
    if let Some(path) = config_path {
        if !path.is_absolute() {
            return Err(AppError::new(
                "INVALID_PATH",
                format!("--config must be absolute, got {}", path.display()),
            ));
        }
    }

    let mut command = Command::new(&location.path);
    command.args(argv);
    if let Some(path) = config_path {
        command.arg("--config").arg(path);
    }
    if let Some(parent) = config_path
        .and_then(Path::parent)
        .or_else(|| location.path.parent())
    {
        command.current_dir(parent);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    // A PyInstaller one-file bootloader starts the interpreter as its own
    // child. Giving the engine its own process group lets a timeout kill the
    // whole tree instead of leaving an interpreter that still locks the engine
    // executable (the class of bug that broke the 0.2.1 update).
    #[cfg(unix)]
    command.process_group(0);

    command.env_clear();
    for (key, value) in std::env::vars_os() {
        if is_inherited_env(&key.to_string_lossy()) {
            command.env(key, value);
        }
    }
    command
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("NO_COLOR", "1");

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    Ok(command)
}

fn is_inherited_env(key: &str) -> bool {
    const ALLOWED: &[&str] = &[
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "HOME",
        "APPDATA",
        "LOCALAPPDATA",
        "USERNAME",
        "USER",
        "HOMEDRIVE",
        "HOMEPATH",
        "COMSPEC",
        "PATHEXT",
        "PROGRAMDATA",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TZ",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "ALL_PROXY",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        // Secret Service (keyring) needs the session bus and the XDG/TMP paths
        // on Linux. Without them `auth set` cannot reach the OS keychain.
        "DBUS_SESSION_BUS_ADDRESS",
        "XDG_RUNTIME_DIR",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
        "TMPDIR",
    ];
    let upper = key.to_ascii_uppercase();
    ALLOWED.contains(&upper.as_str()) || upper.starts_with("LV24_SEO_")
}

/// Exact PIDs of engine sidecars spawned by this process and not reaped yet.
///
/// Only this registry may be killed before an update: matching by image name
/// (`taskkill /IM lv24*`, `pkill -f lv24`) would also hit another installed
/// copy, a portable build, or an unrelated process on the same machine.
#[derive(Default)]
struct ChildRegistry {
    pids: Mutex<BTreeSet<u32>>,
}

impl ChildRegistry {
    /// Track `pid` until the returned guard is dropped.
    fn track(&self, pid: u32) -> TrackedChild<'_> {
        self.lock().insert(pid);
        TrackedChild {
            registry: self,
            pid,
        }
    }

    fn tracked(&self) -> Vec<u32> {
        self.lock().iter().copied().collect()
    }

    fn untrack(&self, pid: u32) {
        self.lock().remove(&pid);
    }

    fn forget(&self, pids: &[u32]) {
        let mut tracked = self.lock();
        for pid in pids {
            tracked.remove(pid);
        }
    }

    fn lock(&self) -> MutexGuard<'_, BTreeSet<u32>> {
        // The lock only guards a set insert/remove, so poisoning carries no
        // partial state; recover instead of panicking the whole app.
        self.pids
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

static ENGINE_CHILDREN: LazyLock<ChildRegistry> = LazyLock::new(ChildRegistry::default);

/// Unregisters an engine PID when its run ends: normal completion, timeout,
/// stdin error, panic, or an explicit kill before an update.
struct TrackedChild<'a> {
    registry: &'a ChildRegistry,
    pid: u32,
}

impl Drop for TrackedChild<'_> {
    fn drop(&mut self) {
        self.registry.untrack(self.pid);
    }
}

fn track_engine_child(pid: u32) -> TrackedChild<'static> {
    ENGINE_CHILDREN.track(pid)
}

/// Exact PIDs of engine sidecars this app instance still tracks.
pub fn tracked_engine_pids() -> Vec<u32> {
    ENGINE_CHILDREN.tracked()
}

/// A webview-supplied run id is a short ASCII key. It identifies one run, never
/// a process, path or command, so it is safe to use as a registry key and in an
/// error detail.
const MAX_RUN_ID_LEN: usize = 64;

fn validate_run_id(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new("INVALID_ARGUMENT", "run id is empty"));
    }
    if trimmed.len() > MAX_RUN_ID_LEN {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("run id is longer than {MAX_RUN_ID_LEN} characters"),
        ));
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "run id may only contain ASCII letters, digits, '-' and '_'",
        ));
    }
    Ok(trimmed.to_string())
}

/// One cancellable run. `pid` is the exact child this process spawned; it is
/// `None` between registration and spawn, and `finished` is the linearization
/// point after which a cancel is refused instead of racing the result.
#[derive(Default)]
struct RunEntry {
    pid: Option<u32>,
    cancelled: Arc<AtomicBool>,
    finished: bool,
}

enum CancelRequest {
    /// The run was active and this request won; `pid` is its exact child, if
    /// the spawn already happened.
    Accepted { pid: Option<u32> },
    /// Unknown id, already finished, or already cancelled. Nothing was killed.
    Refused,
}

/// Per-run registry: run id -> exact child PID and cancellation state.
///
/// The global [`ENGINE_CHILDREN`] registry answers "which sidecars must be
/// stopped before an update". This registry answers "which exact child belongs
/// to the run the user just cancelled". A cancel never matches by image name:
/// it signals one PID (and, on Unix, that PID's process group) that this
/// process spawned for this run.
#[derive(Default)]
struct RunRegistry {
    runs: Mutex<BTreeMap<String, RunEntry>>,
}

impl RunRegistry {
    /// Register `run_id` and return its guard. The guard removes the entry on
    /// every exit path, so a finished run can no longer be cancelled.
    fn begin<'a>(&'a self, run_id: &str) -> AppResult<RunGuard<'a>> {
        let run_id = validate_run_id(run_id)?;
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut runs = self.lock();
        if runs.contains_key(&run_id) {
            return Err(AppError::new(
                "RUN_ALREADY_ACTIVE",
                format!("run {run_id:?} is already active"),
            )
            .with_details(serde_json::json!({ "runId": run_id })));
        }
        runs.insert(
            run_id.clone(),
            RunEntry {
                pid: None,
                cancelled: cancelled.clone(),
                finished: false,
            },
        );
        Ok(RunGuard {
            registry: self,
            run_id,
            cancelled,
        })
    }

    fn attach(&self, run_id: &str, pid: u32) {
        if let Some(entry) = self.lock().get_mut(run_id) {
            entry.pid = Some(pid);
        }
    }

    fn mark_finished(&self, run_id: &str) {
        if let Some(entry) = self.lock().get_mut(run_id) {
            entry.finished = true;
        }
    }

    fn request_cancel(&self, run_id: &str) -> CancelRequest {
        let mut runs = self.lock();
        let Some(entry) = runs.get_mut(run_id) else {
            return CancelRequest::Refused;
        };
        if entry.finished || entry.cancelled.load(Ordering::SeqCst) {
            return CancelRequest::Refused;
        }
        entry.cancelled.store(true, Ordering::SeqCst);
        CancelRequest::Accepted { pid: entry.pid }
    }

    fn finish(&self, run_id: &str) {
        self.lock().remove(run_id);
    }

    fn lock(&self) -> MutexGuard<'_, BTreeMap<String, RunEntry>> {
        // The lock guards map lookups and flags, never a partial file write;
        // recover from a poisoned lock instead of panicking the app.
        self.runs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

static ACTIVE_RUNS: LazyLock<RunRegistry> = LazyLock::new(RunRegistry::default);

/// Unregisters a run when its call returns and exposes the cancellation flag to
/// the supervisor. Holding the guard is what makes a run cancellable.
struct RunGuard<'a> {
    registry: &'a RunRegistry,
    run_id: String,
    cancelled: Arc<AtomicBool>,
}

impl RunGuard<'_> {
    /// Record the exact PID. Returns `true` when a cancel arrived before the
    /// spawn completed; the caller must kill the new child and return
    /// `RUN_CANCELLED` without waiting for an envelope.
    fn attach(&self, pid: u32) -> bool {
        self.registry.attach(&self.run_id, pid);
        self.is_cancelled()
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// The child result is decided from this point on. A later cancel reports
    /// `false` instead of claiming it stopped a run that already produced a
    /// result.
    fn mark_finished(&self) {
        self.registry.mark_finished(&self.run_id);
    }
}

impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        self.registry.finish(&self.run_id);
    }
}

/// Cancel one active run by its stable id.
///
/// Returns `Ok(true)` only when this call won the race against an active run
/// and its exact child was signalled (or the cancel was remembered before the
/// spawn, so the new child is killed at attach). `Ok(false)` means the run
/// already finished, the id is unknown, or the PID no longer names the engine
/// sidecar, so the webview must not claim a cancellation.
pub async fn cancel_run(run_id: &str) -> AppResult<bool> {
    let run_id = validate_run_id(run_id)?;
    match ACTIVE_RUNS.request_cancel(&run_id) {
        CancelRequest::Refused => Ok(false),
        CancelRequest::Accepted { pid: None } => Ok(true),
        CancelRequest::Accepted { pid: Some(pid) } => Ok(cancel_engine_process(pid).await),
    }
}

/// Signal the exact child of a cancelled run and report whether it was killed.
///
/// The run registry only ever stores a PID from the `Child` this process
/// spawned, and the run guard keeps that child unreaped until the result is
/// decided. The extra check keeps a recycled or unrelated PID out of reach: the
/// PID must still be an engine image, or one of the exact children this process
/// currently tracks (a development engine may be a Python interpreter rather
/// than `lv24-seo`).
async fn cancel_engine_process(pid: u32) -> bool {
    if !process_alive(pid).await {
        return false;
    }
    if !is_engine_sidecar(pid).await && !tracked_engine_pids().contains(&pid) {
        log::warn!("cancelled run: PID {pid} is not a tracked engine child; not killing it");
        return false;
    }
    match terminate(pid).await {
        Ok(true) => {
            log::info!("cancelled engine sidecar {pid}");
            true
        }
        Ok(false) => {
            log::warn!("cancelled run: engine sidecar {pid} was already gone");
            false
        }
        Err(err) => {
            log::warn!("cancelled run: cannot kill engine sidecar {pid}: {err}");
            false
        }
    }
}

/// Kill every engine sidecar this app instance still tracks, wait until those
/// PIDs are gone, and report how many processes were terminated.
///
/// Called before the updater replaces files: a live sidecar keeps
/// `engine/lv24-seo/lv24-seo.exe` locked and the NSIS installer cannot replace
/// it. Only exact tracked PIDs are signalled; nothing is matched by name.
pub async fn stop_tracked_children(wait: Duration) -> AppResult<u32> {
    stop_children(&ENGINE_CHILDREN, wait).await
}

async fn stop_children(registry: &ChildRegistry, wait: Duration) -> AppResult<u32> {
    let pids = registry.tracked();
    if pids.is_empty() {
        return Ok(0);
    }

    let mut killed = 0u32;
    let mut failed = Vec::new();
    // PIDs that are gone, or that no longer name our engine. They are never
    // signalled and never wait for the stop deadline.
    let mut released = Vec::new();
    for pid in &pids {
        if !process_alive(*pid).await {
            released.push(*pid);
            continue;
        }
        // SEC-08: the PID may have been reused after a crash. Only an engine
        // image is ours; anything else is left untouched.
        if !is_engine_sidecar(*pid).await {
            log::warn!("tracked PID {pid} is no longer an engine sidecar; not killing it");
            released.push(*pid);
            continue;
        }
        match terminate(*pid).await {
            Ok(true) => killed += 1,
            // The sidecar exited on its own between the snapshot and the kill.
            Ok(false) => released.push(*pid),
            Err(err) => {
                log::warn!("cannot stop engine sidecar {pid}: {err}");
                failed.push(*pid);
            }
        }
    }
    if !failed.is_empty() {
        return Err(AppError::new(
            "ENGINE_STOP_FAILED",
            format!(
                "cannot stop engine sidecar process {}; the installer must not replace a locked engine",
                join_pids(&failed)
            ),
        )
        .with_details(serde_json::json!({ "pids": failed })));
    }

    let pending: Vec<u32> = pids
        .iter()
        .copied()
        .filter(|pid| !released.contains(pid))
        .collect();
    let deadline = Instant::now() + wait;
    loop {
        let mut alive = Vec::new();
        for pid in &pending {
            if process_alive(*pid).await {
                alive.push(*pid);
            }
        }
        if alive.is_empty() {
            break;
        }
        if Instant::now() >= deadline {
            return Err(AppError::new(
                "ENGINE_STOP_FAILED",
                format!(
                    "engine sidecar {} is still running; close it before installing",
                    join_pids(&alive)
                ),
            )
            .with_details(serde_json::json!({
                "pids": alive,
                "waitedMs": wait.as_millis() as u64,
            })));
        }
        tokio::time::sleep(ENGINE_STOP_POLL).await;
    }

    // The guards of finished runs may already have removed their PIDs; this
    // only clears entries whose child was killed here.
    registry.forget(&pids);
    if killed > 0 {
        log::info!("stopped {killed} engine sidecar process(es) before the update");
    }
    Ok(killed)
}

fn join_pids(pids: &[u32]) -> String {
    pids.iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(", ")
}

/// Kill the whole tree of a child this process still owns.
///
/// The child handle is open while this runs, so the OS cannot have recycled the
/// PID: the kill can only reach our own sidecar (SEC-08). On Unix the engine is
/// its own process group leader, so a negative PID signals the bootloader and
/// the interpreter it started.
async fn kill_child_tree(child: &mut tokio::process::Child) {
    if let Some(pid) = child.id() {
        if let Err(err) = terminate_tree(pid).await {
            log::warn!("cannot kill the engine process tree {pid}: {err}");
        }
    }
    // `start_kill` is a no-op when the tree is already gone; `wait` reaps the
    // direct child so no zombie is left behind.
    let _ = child.start_kill();
    let _ = child.wait().await;
}

#[cfg(windows)]
async fn terminate_tree(pid: u32) -> std::io::Result<()> {
    Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await?;
    Ok(())
}

#[cfg(unix)]
async fn terminate_tree(pid: u32) -> std::io::Result<()> {
    // Exact PID first (the only signal whose delivery is guaranteed), then the
    // process group so the interpreter the bootloader started dies too.
    signal_pid(pid).await?;
    let _ = signal_group(pid).await;
    Ok(())
}

#[cfg(all(not(windows), not(unix)))]
async fn terminate_tree(_pid: u32) -> std::io::Result<()> {
    Ok(())
}

/// The image name of a live process. Used to confirm that a tracked PID still
/// belongs to our engine before it is signalled: after a crash the PID can be
/// reused by an unrelated process, and killing it would be collateral damage.
async fn process_image_name(pid: u32) -> Option<String> {
    #[cfg(windows)]
    {
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await
            .ok()?;
        let line = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        // `"ping.exe","4242","Console","1","10 000 K"`
        let name = line.split("\",\"").next()?.trim_matches('"').to_string();
        (!name.is_empty()).then_some(name)
    }
    #[cfg(target_os = "linux")]
    {
        // `/proc/<pid>/exe` is the kernel's own answer: the resolved executable
        // path, with no 15 byte `comm` truncation and no dependency on `ps`
        // being installed in the image.
        if let Ok(target) = std::fs::read_link(format!("/proc/{pid}/exe")) {
            let name = target.to_string_lossy().trim().to_string();
            if !name.is_empty() {
                return Some(name);
            }
        }
    }
    #[cfg(unix)]
    {
        // macOS (and a Linux without `/proc`) reports the full executable path
        // through `comm`; the caller compares only the final component.
        let output = Command::new("ps")
            .args(["-o", "comm=", "-p", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await
            .ok()?;
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        (!name.is_empty()).then_some(name)
    }
    #[cfg(all(not(windows), not(unix)))]
    {
        let _ = pid;
        None
    }
}

/// True only when the live process behind `pid` is the engine executable.
/// An unknown image fails closed: a locked sidecar blocks the update, a killed
/// stranger cannot be undone.
async fn is_engine_sidecar(pid: u32) -> bool {
    let Some(name) = process_image_name(pid).await else {
        return false;
    };
    // Linux and macOS report the full executable path, Windows the image name.
    Path::new(&name)
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(crate::paths::engine_exe_name()))
        .unwrap_or(false)
}

/// `Ok(true)` when the process is confirmed gone, `Ok(false)` when it was
/// already gone (or survived every signal).
///
/// The exact PID is signalled first: `kill -9 -<pid>` is not a reliable probe.
/// procps on Ubuntu 24.04 exits 0 for a process group that does not exist, so a
/// group-only kill can silently do nothing and still look successful. The group
/// signal follows (best effort) because the engine is spawned as a
/// process-group leader and the PyInstaller bootloader starts the interpreter in
/// that group.
#[cfg(windows)]
async fn terminate(pid: u32) -> std::io::Result<bool> {
    if !process_alive(pid).await {
        return Ok(false);
    }
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await?;
    Ok(status.success())
}

#[cfg(unix)]
async fn terminate(pid: u32) -> std::io::Result<bool> {
    if !process_alive(pid).await {
        return Ok(false);
    }
    signal_pid(pid).await?;
    // A non-leader (or an already empty group) is not an error: the exact PID
    // signal above is the one that must land.
    let _ = signal_group(pid).await;
    // Confirm the death. A signal that was accepted but not delivered must not
    // be reported as a kill.
    let deadline = Instant::now() + ENGINE_KILL_WAIT;
    loop {
        if !process_alive(pid).await {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        tokio::time::sleep(ENGINE_STOP_POLL).await;
    }
}

#[cfg(unix)]
async fn signal_pid(pid: u32) -> std::io::Result<()> {
    Command::new("kill")
        .args(["-9", "--", &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await?;
    Ok(())
}

/// Negative PID = the process group whose leader is `pid`. The `--` separator is
/// mandatory: without it `kill` parses `-<pid>` as an option list and, on
/// procps 4.0.x, signals the caller's own process group (verified on Ubuntu
/// 24.04 and Debian bookworm) or silently does nothing.
#[cfg(unix)]
async fn signal_group(pid: u32) -> std::io::Result<()> {
    Command::new("kill")
        .args(["-9", "--", &format!("-{pid}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await?;
    Ok(())
}

#[cfg(windows)]
async fn process_alive(pid: u32) -> bool {
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await;
    let Ok(output) = output else {
        // Without a reliable answer, fail closed: report a still-running
        // sidecar instead of installing over a locked file.
        return true;
    };
    let needle = pid.to_string();
    String::from_utf8_lossy(&output.stdout).lines().any(|line| {
        let mut fields = line.split("\",\"");
        fields.next(); // image name
        fields
            .next()
            .map(|field| field.trim_matches('"').trim() == needle)
            .unwrap_or(false)
    })
}

#[cfg(unix)]
async fn process_alive(pid: u32) -> bool {
    let output = Command::new("ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await;
    let Ok(output) = output else {
        return true;
    };
    if !output.status.success() {
        return false; // ps found no such process
    }
    let stat = String::from_utf8_lossy(&output.stdout);
    let stat = stat.trim();
    // A zombie is already dead; its parent (this app) still has to reap it.
    !stat.is_empty() && !stat.starts_with('Z')
}

/// Tauri ships Windows, Linux and macOS only; refuse instead of pretending on
/// any other target.
#[cfg(all(not(windows), not(unix)))]
async fn terminate(_pid: u32) -> std::io::Result<bool> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "stopping engine sidecars is not implemented on this platform",
    ))
}

#[cfg(all(not(windows), not(unix)))]
async fn process_alive(_pid: u32) -> bool {
    false
}

pub async fn run(
    location: &EngineLocation,
    config_path: Option<&Path>,
    command: CliCommandId,
    args: &CliArgs,
) -> AppResult<CliRunResult> {
    run_inner(location, config_path, command, args, None, None).await
}

/// Same as [`run`], optionally writing bytes to the child's stdin. Auth uses
/// this path so secrets never appear in argv, logs, or error details.
pub async fn run_with_stdin(
    location: &EngineLocation,
    config_path: Option<&Path>,
    command: CliCommandId,
    args: &CliArgs,
    stdin_data: Option<&[u8]>,
) -> AppResult<CliRunResult> {
    run_inner(location, config_path, command, args, stdin_data, None).await
}

/// A cancellable run. The webview supplies the stable run id; while the guard
/// is alive [`cancel_run`] can stop exactly this child. A successful cancel is
/// reported as `RUN_CANCELLED`, never as a timeout, a parse error or a generic
/// process failure.
pub async fn run_tracked(
    location: &EngineLocation,
    config_path: Option<&Path>,
    command: CliCommandId,
    args: &CliArgs,
    run_id: &str,
) -> AppResult<CliRunResult> {
    run_inner(location, config_path, command, args, None, Some(run_id)).await
}

async fn run_inner(
    location: &EngineLocation,
    config_path: Option<&Path>,
    command: CliCommandId,
    args: &CliArgs,
    stdin_data: Option<&[u8]>,
    run_id: Option<&str>,
) -> AppResult<CliRunResult> {
    let argv = build_argv(command, args)?;
    let run = match run_id {
        Some(run_id) => {
            if !command.cancellable() {
                return Err(AppError::new(
                    "RUN_NOT_CANCELLABLE",
                    format!("{} does not support background cancellation", command.id()),
                )
                .with_details(serde_json::json!({ "command": command.id() })));
            }
            // Registered before the spawn so a cancel that arrives while the
            // process is starting is remembered and kills the child at attach.
            Some(ACTIVE_RUNS.begin(run_id)?)
        }
        None => None,
    };
    let mut prepared = build_command(location, config_path, &argv)?;
    if stdin_data.is_some() {
        prepared.stdin(Stdio::piped());
    }
    let started = Instant::now();
    let mut child = match prepared.spawn() {
        Ok(child) => child,
        Err(err) => {
            if let Some(run) = run.as_ref() {
                run.mark_finished();
            }
            return Err(AppError::new(
                "ENGINE_SPAWN",
                format!(
                    "cannot start lv24-seo at {}: {err}",
                    location.path.display()
                ),
            ));
        }
    };
    // The guard lives until `supervise` returns, so the PID is untracked on
    // every path (success, timeout, stdin error, panic).
    let _tracked = child.id().map(track_engine_child);
    if let Some(run) = run.as_ref() {
        if let Some(pid) = child.id() {
            if run.attach(pid) {
                // Cancel arrived before the spawn completed: kill the tree we
                // just created and report the cancellation, not a parse error.
                kill_child_tree(&mut child).await;
                run.mark_finished();
                return Err(cancelled_error(command));
            }
        }
    }
    supervise(
        child,
        command,
        stdin_data,
        command.timeout(),
        started,
        run.as_ref(),
    )
    .await
}

/// Collect one engine run under a single timeout budget. `started` is recorded
/// before the spawn so `duration_ms` covers the whole run, and the same budget
/// bounds both the stdin write and the process wait. `run` is the optional
/// per-run cancellation guard: every terminal path marks the run finished
/// before it reports a result, so a cancel cannot claim a run that already
/// produced an envelope.
async fn supervise(
    mut child: tokio::process::Child,
    command: CliCommandId,
    stdin_data: Option<&[u8]>,
    timeout: Duration,
    started: Instant,
    run: Option<&RunGuard<'_>>,
) -> AppResult<CliRunResult> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::new("ENGINE_SPAWN", "engine stdout pipe was not created"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::new("ENGINE_SPAWN", "engine stderr pipe was not created"))?;
    let stdout_task = tokio::spawn(read_bounded(stdout, MAX_STDOUT));
    let stderr_task = tokio::spawn(read_bounded(stderr, MAX_STDERR));

    if let Some(data) = stdin_data {
        let budget = timeout.saturating_sub(started.elapsed());
        match tokio::time::timeout(budget, write_stdin(&mut child, data)).await {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                kill_child_tree(&mut child).await;
                stdout_task.abort();
                stderr_task.abort();
                if finish_run(run) {
                    return Err(cancelled_error(command));
                }
                return Err(err);
            }
            Err(_) => {
                kill_child_tree(&mut child).await;
                stdout_task.abort();
                stderr_task.abort();
                if finish_run(run) {
                    return Err(cancelled_error(command));
                }
                return Err(timeout_error(command, timeout));
            }
        }
    }

    let remaining = timeout.saturating_sub(started.elapsed());
    let waited = tokio::time::timeout(remaining, child.wait()).await;

    let status = match waited {
        Ok(Ok(status)) => status,
        Ok(Err(err)) => {
            stdout_task.abort();
            stderr_task.abort();
            if finish_run(run) {
                return Err(cancelled_error(command));
            }
            return Err(AppError::new(
                "ENGINE_WAIT",
                format!("engine process failed: {err}"),
            ));
        }
        Err(_) => {
            kill_child_tree(&mut child).await;
            stdout_task.abort();
            stderr_task.abort();
            if finish_run(run) {
                return Err(cancelled_error(command));
            }
            return Err(timeout_error(command, timeout));
        }
    };

    // The child exited. If a cancel won the race, report that instead of
    // parsing the partial stdout the kill left behind.
    if finish_run(run) {
        stdout_task.abort();
        stderr_task.abort();
        return Err(cancelled_error(command));
    }

    let (stdout_bytes, stdout_truncated) = stdout_task
        .await
        .map_err(|err| AppError::new("ENGINE_READ", format!("stdout reader failed: {err}")))?;
    let (stderr_bytes, stderr_truncated) = stderr_task
        .await
        .map_err(|err| AppError::new("ENGINE_READ", format!("stderr reader failed: {err}")))?;

    if stdout_truncated {
        return Err(AppError::new(
            "CLI_OUTPUT_TOO_LARGE",
            format!(
                "lv24-seo {} wrote more than {} bytes of stdout",
                command.id(),
                MAX_STDOUT
            ),
        )
        .with_details(serde_json::json!({
            "command": command.id(),
            "limitBytes": MAX_STDOUT,
            "exitCode": status.code(),
        })));
    }

    let stdout_text = String::from_utf8_lossy(&stdout_bytes);
    let mut stderr_text = String::from_utf8_lossy(&stderr_bytes).into_owned();
    if stderr_truncated {
        stderr_text.push_str("\n[stderr truncated]");
    }
    let envelope = if command == CliCommandId::AuthSet {
        // Auth is the only command that may print a narrow confirmation object
        // after the envelope; read the first document as the envelope.
        parse_envelope_first(&stdout_text)
    } else {
        parse_envelope(&stdout_text)
    }
    .map_err(|err| {
        err.with_details(serde_json::json!({
            "command": command.id(),
            "exitCode": status.code(),
            "stdout": preview(&stdout_text),
            "stderr": preview(&stderr_text),
        }))
    })?;

    Ok(CliRunResult {
        command: command.id().to_string(),
        exit_code: status.code(),
        envelope,
        // The engine quotes config lines and argv in tracebacks; a credential
        // must never cross into the webview, the log or a screenshot.
        stderr: crate::error::redact_secrets(&stderr_text),
        duration_ms: started.elapsed().as_millis() as u64,
        truncated: stdout_truncated || stderr_truncated,
        writes_local_state: command.write_kind() == WriteKind::LocalState,
    })
}

/// Mark the run finished, then report whether a cancel won the race.
fn finish_run(run: Option<&RunGuard<'_>>) -> bool {
    match run {
        Some(run) => {
            run.mark_finished();
            run.is_cancelled()
        }
        None => false,
    }
}

fn cancelled_error(command: CliCommandId) -> AppError {
    AppError::new(
        "RUN_CANCELLED",
        format!("lv24-seo {} was cancelled", command.id()),
    )
    .with_details(serde_json::json!({ "command": command.id() }))
}

fn timeout_error(command: CliCommandId, timeout: Duration) -> AppError {
    AppError::new(
        "CLI_TIMEOUT",
        format!(
            "lv24-seo {} timed out after {}s",
            command.id(),
            timeout.as_secs()
        ),
    )
    .with_details(serde_json::json!({
        "command": command.id(),
        "timeoutSeconds": timeout.as_secs(),
    }))
}

async fn write_stdin(child: &mut tokio::process::Child, data: &[u8]) -> AppResult<()> {
    let mut handle = child
        .stdin
        .take()
        .ok_or_else(|| AppError::new("ENGINE_STDIN", "engine stdin pipe was not created"))?;
    handle.write_all(data).await?;
    handle.write_all(b"\n").await?;
    handle.shutdown().await?;
    Ok(())
}

async fn read_bounded<R>(mut reader: R, limit: usize) -> (Vec<u8>, bool)
where
    R: AsyncRead + Unpin,
{
    let mut captured = Vec::new();
    let mut buffer = [0u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read) => {
                let remaining = limit.saturating_sub(captured.len());
                if remaining > 0 {
                    captured.extend_from_slice(&buffer[..read.min(remaining)]);
                }
                if read > remaining {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    (captured, truncated)
}

/// Parse exactly one `{ok,data,meta,warnings}` envelope. Anything else is a
/// typed contract error rather than a panic.
pub fn parse_envelope(stdout: &str) -> AppResult<Value> {
    let trimmed = stdout.trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            "CLI_INVALID_JSON",
            "lv24-seo produced no stdout; expected one JSON envelope",
        ));
    }
    let value: Value = serde_json::from_str(trimmed).map_err(|err| {
        AppError::new(
            "CLI_INVALID_JSON",
            format!("lv24-seo stdout is not valid JSON: {err}"),
        )
        .with_details(serde_json::json!({
            "preview": preview(trimmed),
        }))
    })?;
    validate_envelope(value)
}

/// Parse the first JSON document and ignore trailing documents. Only used for
/// `auth set`, whose CLI prints an extra non-secret confirmation object.
pub fn parse_envelope_first(stdout: &str) -> AppResult<Value> {
    let trimmed = stdout.trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            "CLI_INVALID_JSON",
            "lv24-seo produced no stdout; expected one JSON envelope",
        ));
    }
    let mut stream = serde_json::Deserializer::from_str(trimmed).into_iter::<Value>();
    let value = stream
        .next()
        .ok_or_else(|| AppError::new("CLI_INVALID_JSON", "lv24-seo produced no JSON envelope"))?;
    let value = value.map_err(|err| {
        AppError::new(
            "CLI_INVALID_JSON",
            format!("lv24-seo stdout is not valid JSON: {err}"),
        )
        .with_details(serde_json::json!({
            "preview": preview(trimmed),
        }))
    })?;
    validate_envelope(value)
}

fn validate_envelope(value: Value) -> AppResult<Value> {
    let object = value.as_object().ok_or_else(|| {
        AppError::new(
            "CLI_INVALID_ENVELOPE",
            "lv24-seo JSON is not an object envelope",
        )
    })?;
    if !object.get("ok").map(Value::is_boolean).unwrap_or(false) {
        return Err(AppError::new(
            "CLI_INVALID_ENVELOPE",
            "lv24-seo envelope has no boolean 'ok' field",
        ));
    }
    if let Some(warnings) = object.get("warnings") {
        if !warnings.is_array() {
            return Err(AppError::new(
                "CLI_INVALID_ENVELOPE",
                "lv24-seo envelope 'warnings' is not an array",
            ));
        }
    }
    if let Some(meta) = object.get("meta") {
        if !meta.is_object() {
            return Err(AppError::new(
                "CLI_INVALID_ENVELOPE",
                "lv24-seo envelope 'meta' is not an object",
            ));
        }
    }
    Ok(value)
}

fn preview(value: &str) -> String {
    const LIMIT: usize = 300;
    // Redact before truncating: a token cut in half by the preview would no
    // longer match the `token = "..."` pattern and would reach the webview.
    let compact = crate::error::redact_secrets(value)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let mut preview: String = compact.chars().take(LIMIT).collect();
    if compact.chars().count() > LIMIT {
        preview.push('…');
    }
    preview
}

/// `lv24-seo version --json` handshake. It never blocks startup when the engine
/// is missing; callers treat the error as status data.
pub async fn probe_version(location: &EngineLocation) -> AppResult<String> {
    let result = run(location, None, CliCommandId::Version, &CliArgs::default()).await?;
    let ok = result
        .envelope
        .get("ok")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let version = result
        .envelope
        .pointer("/data/version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match (ok, version) {
        (true, Some(version)) => Ok(version.to_string()),
        _ => Err(AppError::new(
            "ENGINE_VERSION",
            "lv24-seo version --json returned no version",
        )
        .with_details(serde_json::json!({
            "exitCode": result.exit_code,
            "envelope": result.envelope,
            "stderr": result.stderr,
        }))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_list_accepts_known_commands_and_rejects_others() {
        for id in [
            "version",
            "stats",
            "config_show",
            "doctor",
            "properties",
            "auth_status",
            "report_weekly",
            "report_diff",
            "crawl",
            "init",
            "schedule_print",
            "logs_analyze",
            "tasks_list",
            "tasks_add",
            "tasks_update",
            "backup_create",
            "backup_restore",
            "portfolio_list",
            "schedule_install",
        ] {
            assert_eq!(CliCommandId::parse(id).unwrap().id(), id);
        }
        for id in ["shell", "rm", "auth_set", "report_send", "schedule", ""] {
            assert_eq!(
                CliCommandId::parse(id).unwrap_err().code(),
                "INVALID_COMMAND"
            );
        }
    }

    #[test]
    fn stats_argv_is_fixed_and_always_json() {
        let argv = build_argv(CliCommandId::Stats, &CliArgs::default()).unwrap();
        assert_eq!(
            argv,
            vec!["stats", "--days", "7", "--lag-days", "2", "--json"]
        );
        let argv = build_argv(
            CliCommandId::Stats,
            &CliArgs {
                days: Some(30),
                lag_days: Some(0),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert_eq!(
            argv,
            vec!["stats", "--days", "30", "--lag-days", "0", "--json"]
        );
    }

    #[test]
    fn report_diff_argv_only_carries_validated_periods() {
        let argv = build_argv(
            CliCommandId::ReportDiff,
            &CliArgs {
                base: Some("2026-10-31..2026-11-06".into()),
                head: Some("2026-11-07..2026-11-13".into()),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert_eq!(
            argv,
            vec![
                "report",
                "diff",
                "--base",
                "2026-10-31..2026-11-06",
                "--head",
                "2026-11-07..2026-11-13",
                "--json"
            ]
        );
    }

    #[test]
    fn crawl_argv_validates_url_and_budget() {
        let argv = build_argv(
            CliCommandId::Crawl,
            &CliArgs {
                start: Some("https://example.com/".into()),
                max_urls: Some(250),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert_eq!(
            argv,
            vec![
                "crawl",
                "--start",
                "https://example.com/",
                "--max-urls",
                "250",
                "--json"
            ]
        );
        assert_eq!(
            build_argv(
                CliCommandId::Crawl,
                &CliArgs {
                    start: Some("file:///etc/passwd".into()),
                    ..CliArgs::default()
                }
            )
            .unwrap_err()
            .code(),
            "INVALID_ARGUMENT"
        );
        assert_eq!(
            build_argv(
                CliCommandId::Crawl,
                &CliArgs {
                    max_urls: Some(0),
                    ..CliArgs::default()
                }
            )
            .unwrap_err()
            .code(),
            "INVALID_ARGUMENT"
        );
    }

    #[test]
    fn arguments_are_rejected_for_read_only_commands() {
        let error = build_argv(
            CliCommandId::Doctor,
            &CliArgs {
                days: Some(7),
                ..CliArgs::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.code(), "INVALID_ARGUMENT");
    }

    fn write_log(dir: &Path) -> String {
        let file = dir.join("access.log");
        std::fs::write(&file, "{\"request\":\"/\"}\n").unwrap();
        file.display().to_string()
    }

    #[test]
    fn logs_analyze_argv_carries_one_file_and_an_optional_bot() {
        let dir = tempfile::tempdir().unwrap();
        let file = write_log(dir.path());
        let argv = build_argv(
            CliCommandId::LogsAnalyze,
            &CliArgs {
                file: Some(file.clone()),
                bot: Some("GoogleBot".into()),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert_eq!(
            argv,
            vec![
                "logs",
                "analyze",
                "--file",
                file.as_str(),
                "--bot",
                "googlebot",
                "--json"
            ]
        );

        // Empty bot means "all bots": no flag at all.
        for bot in [None, Some(String::new())] {
            let argv = build_argv(
                CliCommandId::LogsAnalyze,
                &CliArgs {
                    file: Some(file.clone()),
                    bot,
                    ..CliArgs::default()
                },
            )
            .unwrap();
            assert_eq!(
                argv,
                vec!["logs", "analyze", "--file", file.as_str(), "--json"]
            );
        }

        assert_eq!(
            build_argv(
                CliCommandId::LogsAnalyze,
                &CliArgs {
                    file: Some(file.clone()),
                    bot: Some("ahrefsbot".into()),
                    ..CliArgs::default()
                }
            )
            .unwrap_err()
            .code(),
            "INVALID_ARGUMENT"
        );
        assert!(!CliCommandId::LogsAnalyze.requires_config());
        assert_eq!(CliCommandId::LogsAnalyze.write_kind(), WriteKind::None);
    }

    #[test]
    fn logs_analyze_rejects_unsafe_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let nested = root.join("nested");
        std::fs::create_dir(&nested).unwrap();
        for file in [
            "access.log".to_string(),
            root.join("*.log").display().to_string(),
            root.join("missing.log").display().to_string(),
            nested.display().to_string(),
            r"\\server\share\access.log".to_string(),
            r"\\.\PhysicalDrive0".to_string(),
            r"\\?\C:\tmp\access.log".to_string(),
        ] {
            assert_eq!(
                build_argv(
                    CliCommandId::LogsAnalyze,
                    &CliArgs {
                        file: Some(file.clone()),
                        ..CliArgs::default()
                    }
                )
                .unwrap_err()
                .code(),
                "INVALID_PATH",
                "{file:?}"
            );
        }
        assert_eq!(
            build_argv(CliCommandId::LogsAnalyze, &CliArgs::default())
                .unwrap_err()
                .code(),
            "INVALID_ARGUMENT"
        );
    }

    #[test]
    fn tasks_list_argv_is_filtered_and_bounded() {
        let argv = build_argv(
            CliCommandId::TasksList,
            &CliArgs {
                property: Some("sc-domain:example.com".into()),
                kind: Some("decay".into()),
                state: Some("in_progress".into()),
                limit: Some(50),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert_eq!(
            argv,
            vec![
                "tasks",
                "list",
                "--property",
                "sc-domain:example.com",
                "--kind",
                "decay",
                "--state",
                "in_progress",
                "--limit",
                "50",
                "--json"
            ]
        );
        assert_eq!(
            build_argv(CliCommandId::TasksList, &CliArgs::default()).unwrap(),
            vec!["tasks", "list", "--json"]
        );
        for (field, args) in [
            (
                "limit 0",
                CliArgs {
                    limit: Some(0),
                    ..CliArgs::default()
                },
            ),
            (
                "limit 501",
                CliArgs {
                    limit: Some(501),
                    ..CliArgs::default()
                },
            ),
            (
                "state",
                CliArgs {
                    state: Some("done".into()),
                    ..CliArgs::default()
                },
            ),
            (
                "kind",
                CliArgs {
                    kind: Some("x".repeat(65)),
                    ..CliArgs::default()
                },
            ),
            (
                "property",
                CliArgs {
                    property: Some("a b".into()),
                    ..CliArgs::default()
                },
            ),
        ] {
            assert_eq!(
                build_argv(CliCommandId::TasksList, &args)
                    .unwrap_err()
                    .code(),
                "INVALID_ARGUMENT",
                "{field}"
            );
        }
        assert!(CliCommandId::TasksList.requires_config());
        assert_eq!(CliCommandId::TasksList.write_kind(), WriteKind::None);
    }

    #[test]
    fn tasks_add_argv_encodes_a_bounded_payload_object() {
        let argv = build_argv(
            CliCommandId::TasksAdd,
            &CliArgs {
                kind: Some("decay".into()),
                url: Some("https://example.com/blog/post".into()),
                rule: Some("content-decay".into()),
                property: Some("sc-domain:example.com".into()),
                payload: Some(serde_json::json!({"months_stale": 16})),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert_eq!(
            argv,
            vec![
                "tasks",
                "add",
                "--kind",
                "decay",
                "--url",
                "https://example.com/blog/post",
                "--rule",
                "content-decay",
                "--property",
                "sc-domain:example.com",
                "--payload",
                "{\"months_stale\":16}",
                "--json"
            ]
        );

        // Site-relative findings are accepted; optional fields are omitted.
        let argv = build_argv(
            CliCommandId::TasksAdd,
            &CliArgs {
                kind: Some("finding".into()),
                url: Some("/blog/post".into()),
                rule: Some("soft-404".into()),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert_eq!(
            argv,
            vec![
                "tasks",
                "add",
                "--kind",
                "finding",
                "--url",
                "/blog/post",
                "--rule",
                "soft-404",
                "--json"
            ]
        );
        assert_eq!(CliCommandId::TasksAdd.write_kind(), WriteKind::LocalState);

        for (field, args) in [
            (
                "relative url",
                CliArgs {
                    url: Some("blog/post".into()),
                    ..CliArgs::default()
                },
            ),
            (
                "file url",
                CliArgs {
                    url: Some("file:///etc/passwd".into()),
                    ..CliArgs::default()
                },
            ),
            (
                "protocol-relative",
                CliArgs {
                    url: Some("//example.com/x".into()),
                    ..CliArgs::default()
                },
            ),
            (
                "kind",
                CliArgs {
                    kind: Some("bad\tkind".into()),
                    ..CliArgs::default()
                },
            ),
            (
                "rule",
                CliArgs {
                    rule: Some("r".repeat(257)),
                    ..CliArgs::default()
                },
            ),
            (
                "payload array",
                CliArgs {
                    payload: Some(serde_json::json!([1, 2])),
                    ..CliArgs::default()
                },
            ),
        ] {
            let mut args = args;
            args.kind = args.kind.or_else(|| Some("decay".into()));
            args.url = args.url.or_else(|| Some("https://example.com/".into()));
            args.rule = args.rule.or_else(|| Some("content-decay".into()));
            assert_eq!(
                build_argv(CliCommandId::TasksAdd, &args)
                    .unwrap_err()
                    .code(),
                "INVALID_ARGUMENT",
                "{field}"
            );
        }

        let oversized = serde_json::json!({ "blob": "x".repeat(17 * 1024) });
        assert_eq!(
            build_argv(
                CliCommandId::TasksAdd,
                &CliArgs {
                    kind: Some("decay".into()),
                    url: Some("/blog/post".into()),
                    rule: Some("content-decay".into()),
                    payload: Some(oversized),
                    ..CliArgs::default()
                }
            )
            .unwrap_err()
            .code(),
            "INVALID_ARGUMENT"
        );
    }

    #[test]
    fn tasks_update_argv_requires_a_positive_id_and_a_known_state() {
        let argv = build_argv(
            CliCommandId::TasksUpdate,
            &CliArgs {
                id: Some(42),
                state: Some("verified".into()),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert_eq!(
            argv,
            vec!["tasks", "update", "42", "--state", "verified", "--json"]
        );
        assert_eq!(
            CliCommandId::TasksUpdate.write_kind(),
            WriteKind::LocalState
        );

        for (field, args) in [
            (
                "zero",
                CliArgs {
                    id: Some(0),
                    state: Some("open".into()),
                    ..CliArgs::default()
                },
            ),
            (
                "negative",
                CliArgs {
                    id: Some(-1),
                    state: Some("open".into()),
                    ..CliArgs::default()
                },
            ),
            (
                "missing id",
                CliArgs {
                    state: Some("open".into()),
                    ..CliArgs::default()
                },
            ),
            (
                "state",
                CliArgs {
                    id: Some(1),
                    state: Some("closed".into()),
                    ..CliArgs::default()
                },
            ),
            (
                "missing state",
                CliArgs {
                    id: Some(1),
                    ..CliArgs::default()
                },
            ),
        ] {
            assert_eq!(
                build_argv(CliCommandId::TasksUpdate, &args)
                    .unwrap_err()
                    .code(),
                "INVALID_ARGUMENT",
                "{field}"
            );
        }
    }

    #[test]
    fn backup_create_argv_takes_one_existing_directory() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().display().to_string();
        assert_eq!(
            build_argv(
                CliCommandId::BackupCreate,
                &CliArgs {
                    out: Some(out.clone()),
                    ..CliArgs::default()
                }
            )
            .unwrap(),
            vec!["backup", "create", "--out", out.as_str(), "--json"]
        );
        assert_eq!(
            build_argv(
                CliCommandId::BackupCreate,
                &CliArgs {
                    out: Some(out.clone()),
                    force: Some(true),
                    ..CliArgs::default()
                }
            )
            .unwrap(),
            vec![
                "backup",
                "create",
                "--out",
                out.as_str(),
                "--force",
                "--json"
            ]
        );
        // `force: false` is the default and adds no flag.
        assert_eq!(
            build_argv(
                CliCommandId::BackupCreate,
                &CliArgs {
                    out: Some(out.clone()),
                    force: Some(false),
                    ..CliArgs::default()
                }
            )
            .unwrap(),
            vec!["backup", "create", "--out", out.as_str(), "--json"]
        );
        assert_eq!(
            CliCommandId::BackupCreate.write_kind(),
            WriteKind::LocalState
        );

        let file = dir.path().join("archive.zip");
        std::fs::write(&file, "x").unwrap();
        for (field, out) in [
            ("relative", "backups".to_string()),
            ("missing", dir.path().join("missing").display().to_string()),
            ("file", file.display().to_string()),
            ("unc", r"\\server\share\backups".to_string()),
        ] {
            assert_eq!(
                build_argv(
                    CliCommandId::BackupCreate,
                    &CliArgs {
                        out: Some(out),
                        ..CliArgs::default()
                    }
                )
                .unwrap_err()
                .code(),
                "INVALID_PATH",
                "{field}"
            );
        }
    }

    #[test]
    fn backup_restore_argv_plans_without_a_token_and_applies_with_both() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("lv24-seo-backup.zip");
        std::fs::write(&archive, "PK\u{3}\u{4}").unwrap();
        let config = dir.path().join("seo.toml");
        let file = archive.display().to_string();
        let config_text = config.display().to_string();

        // Plan phase: no write opt-in and no token.
        assert_eq!(
            build_argv(
                CliCommandId::BackupRestore,
                &CliArgs {
                    file: Some(file.clone()),
                    config_path: Some(config_text.clone()),
                    ..CliArgs::default()
                }
            )
            .unwrap(),
            vec![
                "backup",
                "restore",
                "--file",
                file.as_str(),
                "--config",
                config_text.as_str(),
                "--json"
            ]
        );

        // Apply phase: the explicit opt-in plus the plan token.
        assert_eq!(
            build_argv(
                CliCommandId::BackupRestore,
                &CliArgs {
                    file: Some(file.clone()),
                    config_path: Some(config_text.clone()),
                    allow_write: Some(true),
                    confirm: Some("1700000000:abcdef0123".into()),
                    ..CliArgs::default()
                }
            )
            .unwrap(),
            vec![
                "backup",
                "restore",
                "--file",
                file.as_str(),
                "--config",
                config_text.as_str(),
                "--allow-write",
                "--confirm",
                "1700000000:abcdef0123",
                "--json"
            ]
        );

        // `allowWrite=false` is the plan phase and adds no flag.
        assert_eq!(
            build_argv(
                CliCommandId::BackupRestore,
                &CliArgs {
                    file: Some(file.clone()),
                    config_path: Some(config_text.clone()),
                    allow_write: Some(false),
                    ..CliArgs::default()
                }
            )
            .unwrap(),
            vec![
                "backup",
                "restore",
                "--file",
                file.as_str(),
                "--config",
                config_text.as_str(),
                "--json"
            ]
        );

        // A token without the opt-in would ask the engine to apply silently.
        for args in [
            CliArgs {
                file: Some(file.clone()),
                config_path: Some(config_text.clone()),
                confirm: Some("1700000000:abcdef".into()),
                ..CliArgs::default()
            },
            CliArgs {
                file: Some(file.clone()),
                config_path: Some(config_text.clone()),
                allow_write: Some(false),
                confirm: Some("1700000000:abcdef".into()),
                ..CliArgs::default()
            },
        ] {
            assert_eq!(
                build_argv(CliCommandId::BackupRestore, &args)
                    .unwrap_err()
                    .code(),
                "INVALID_ARGUMENT"
            );
        }

        // Token charset stays narrow: no whitespace, control characters or
        // option-looking values.
        for token in ["", " ", "1700 000:abc", "1:abc\n", "-confirm"] {
            assert_eq!(
                build_argv(
                    CliCommandId::BackupRestore,
                    &CliArgs {
                        file: Some(file.clone()),
                        config_path: Some(config_text.clone()),
                        allow_write: Some(true),
                        confirm: Some(token.into()),
                        ..CliArgs::default()
                    }
                )
                .unwrap_err()
                .code(),
                "INVALID_ARGUMENT",
                "{token:?}"
            );
        }

        // One existing local .zip only.
        let directory_named_zip = dir.path().join("folder.zip");
        std::fs::create_dir(&directory_named_zip).unwrap();
        for archive in [
            "backup.zip".to_string(),
            dir.path().join("missing.zip").display().to_string(),
            dir.path().join("backup.tar").display().to_string(),
            directory_named_zip.display().to_string(),
            dir.path().join("*.zip").display().to_string(),
            r"\\server\share\backup.zip".to_string(),
        ] {
            assert_eq!(
                build_argv(
                    CliCommandId::BackupRestore,
                    &CliArgs {
                        file: Some(archive.clone()),
                        config_path: Some(config_text.clone()),
                        ..CliArgs::default()
                    }
                )
                .unwrap_err()
                .code(),
                "INVALID_PATH",
                "{archive:?}"
            );
        }
        assert_eq!(
            build_argv(
                CliCommandId::BackupRestore,
                &CliArgs {
                    file: Some(file.clone()),
                    ..CliArgs::default()
                }
            )
            .unwrap_err()
            .code(),
            "INVALID_ARGUMENT"
        );

        assert!(CliCommandId::BackupRestore.requires_config());
        assert_eq!(
            CliCommandId::BackupRestore.write_kind(),
            WriteKind::LocalState
        );
    }

    #[test]
    fn portfolio_list_argv_takes_a_picked_root_and_a_bounded_limit() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().display().to_string();

        assert_eq!(
            build_argv(
                CliCommandId::PortfolioList,
                &CliArgs {
                    root: Some(root.clone()),
                    ..CliArgs::default()
                }
            )
            .unwrap(),
            vec!["portfolio", "list", "--root", root.as_str(), "--json"]
        );
        assert_eq!(
            build_argv(
                CliCommandId::PortfolioList,
                &CliArgs {
                    root: Some(root.clone()),
                    limit: Some(25),
                    ..CliArgs::default()
                }
            )
            .unwrap(),
            vec![
                "portfolio",
                "list",
                "--root",
                root.as_str(),
                "--limit",
                "25",
                "--json"
            ]
        );

        for limit in [0, 51] {
            assert_eq!(
                build_argv(
                    CliCommandId::PortfolioList,
                    &CliArgs {
                        root: Some(root.clone()),
                        limit: Some(limit),
                        ..CliArgs::default()
                    }
                )
                .unwrap_err()
                .code(),
                "INVALID_ARGUMENT",
                "{limit}"
            );
        }

        let file = dir.path().join("seo.toml");
        std::fs::write(&file, "version = 1\n").unwrap();
        for root in [
            "projects".to_string(),
            dir.path().join("missing").display().to_string(),
            file.display().to_string(),
            r"\\server\share\projects".to_string(),
        ] {
            assert_eq!(
                build_argv(
                    CliCommandId::PortfolioList,
                    &CliArgs {
                        root: Some(root.clone()),
                        ..CliArgs::default()
                    }
                )
                .unwrap_err()
                .code(),
                "INVALID_PATH",
                "{root:?}"
            );
        }
        assert_eq!(
            build_argv(CliCommandId::PortfolioList, &CliArgs::default())
                .unwrap_err()
                .code(),
            "INVALID_ARGUMENT"
        );

        // A read-only roll-up: no config, no local write.
        assert!(!CliCommandId::PortfolioList.requires_config());
        assert_eq!(CliCommandId::PortfolioList.write_kind(), WriteKind::None);
    }

    #[test]
    fn schedule_install_argv_sends_the_confirmed_write_opt_in() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("seo.toml");
        let config_text = config.display().to_string();

        // The engine owns the default cron for each kind and plans by default;
        // `--allow-write` is the confirmed opt-in that writes the host job.
        assert_eq!(
            build_argv(
                CliCommandId::ScheduleInstall,
                &CliArgs {
                    kind: Some("Weekly".into()),
                    config_path: Some(config_text.clone()),
                    allow_write: Some(true),
                    ..CliArgs::default()
                }
            )
            .unwrap(),
            vec![
                "schedule",
                "install",
                "--kind",
                "weekly",
                "--config",
                config_text.as_str(),
                "--allow-write",
                "--json"
            ]
        );

        assert_eq!(
            build_argv(
                CliCommandId::ScheduleInstall,
                &CliArgs {
                    kind: Some("daily".into()),
                    cron: Some("  0   7 * * * ".into()),
                    config_path: Some(config_text.clone()),
                    allow_write: Some(true),
                    ..CliArgs::default()
                }
            )
            .unwrap(),
            vec![
                "schedule",
                "install",
                "--kind",
                "daily",
                "--cron",
                "0 7 * * *",
                "--config",
                config_text.as_str(),
                "--allow-write",
                "--json"
            ]
        );

        for (field, args) in [
            (
                "kind",
                CliArgs {
                    kind: Some("monthly".into()),
                    config_path: Some(config_text.clone()),
                    allow_write: Some(true),
                    ..CliArgs::default()
                },
            ),
            (
                "missing kind",
                CliArgs {
                    config_path: Some(config_text.clone()),
                    allow_write: Some(true),
                    ..CliArgs::default()
                },
            ),
            (
                "cron",
                CliArgs {
                    kind: Some("weekly".into()),
                    cron: Some("0 6 * *".into()),
                    config_path: Some(config_text.clone()),
                    allow_write: Some(true),
                    ..CliArgs::default()
                },
            ),
            (
                "missing config",
                CliArgs {
                    kind: Some("weekly".into()),
                    allow_write: Some(true),
                    ..CliArgs::default()
                },
            ),
            (
                "confirm token",
                CliArgs {
                    kind: Some("weekly".into()),
                    config_path: Some(config_text.clone()),
                    allow_write: Some(true),
                    confirm: Some("1700000000:abcdef".into()),
                    ..CliArgs::default()
                },
            ),
        ] {
            assert_eq!(
                build_argv(CliCommandId::ScheduleInstall, &args)
                    .unwrap_err()
                    .code(),
                "INVALID_ARGUMENT",
                "{field}"
            );
        }

        // The plan-only path must never reach the host scheduler: without the
        // confirmed opt-in the shell refuses before spawning the engine.
        for allow_write in [None, Some(false)] {
            assert_eq!(
                build_argv(
                    CliCommandId::ScheduleInstall,
                    &CliArgs {
                        kind: Some("weekly".into()),
                        config_path: Some(config_text.clone()),
                        allow_write,
                        ..CliArgs::default()
                    }
                )
                .unwrap_err()
                .code(),
                "CONFIRM_REQUIRED"
            );
        }

        // The preview stays read-only and never carries the write flag.
        let preview = build_argv(
            CliCommandId::SchedulePrint,
            &CliArgs {
                cron: Some("0 6 * * 1".into()),
                target: Some("windows".into()),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert!(!preview.iter().any(|arg| arg == "--allow-write"));
        assert_eq!(
            build_argv(
                CliCommandId::SchedulePrint,
                &CliArgs {
                    cron: Some("0 6 * * 1".into()),
                    target: Some("windows".into()),
                    allow_write: Some(true),
                    ..CliArgs::default()
                }
            )
            .unwrap_err()
            .code(),
            "INVALID_ARGUMENT"
        );

        assert!(CliCommandId::ScheduleInstall.requires_config());
        assert_eq!(
            CliCommandId::ScheduleInstall.write_kind(),
            WriteKind::LocalState
        );
    }

    #[test]
    fn restore_portfolio_and_install_arguments_are_rejected_by_other_commands() {
        let dir = tempfile::tempdir().unwrap();
        let foreign = [
            CliArgs {
                allow_write: Some(true),
                ..CliArgs::default()
            },
            CliArgs {
                confirm: Some("1700000000:abcdef".into()),
                ..CliArgs::default()
            },
            CliArgs {
                root: Some(dir.path().display().to_string()),
                ..CliArgs::default()
            },
        ];
        for command in [
            CliCommandId::Version,
            CliCommandId::Stats,
            CliCommandId::ReportWeekly,
            CliCommandId::Crawl,
            CliCommandId::Init,
            CliCommandId::SchedulePrint,
            CliCommandId::LogsAnalyze,
            CliCommandId::TasksList,
            CliCommandId::BackupCreate,
        ] {
            for args in &foreign {
                assert_eq!(
                    build_argv(command, args).unwrap_err().code(),
                    "INVALID_ARGUMENT",
                    "{}",
                    command.id()
                );
            }
        }
    }

    #[test]
    fn insight_arguments_are_rejected_by_existing_commands() {
        for command in [
            CliCommandId::Stats,
            CliCommandId::Doctor,
            CliCommandId::Init,
        ] {
            let error = build_argv(
                command,
                &CliArgs {
                    file: Some(
                        std::env::temp_dir()
                            .join("access.log")
                            .display()
                            .to_string(),
                    ),
                    ..CliArgs::default()
                },
            )
            .unwrap_err();
            assert_eq!(error.code(), "INVALID_ARGUMENT", "{}", command.id());
        }
        assert_eq!(
            build_argv(
                CliCommandId::Stats,
                &CliArgs {
                    id: Some(1),
                    ..CliArgs::default()
                }
            )
            .unwrap_err()
            .code(),
            "INVALID_ARGUMENT"
        );
    }

    #[test]
    fn invalid_periods_are_rejected() {
        for period in [
            "2026-11-07",
            "2026-02-30..2026-03-01",
            "2026-11-13..2026-11-07",
            "2026-1-01..2026-01-02",
        ] {
            let error = build_argv(
                CliCommandId::ReportDiff,
                &CliArgs {
                    base: Some(period.into()),
                    ..CliArgs::default()
                },
            )
            .unwrap_err();
            assert_eq!(error.code(), "INVALID_ARGUMENT", "{period}");
        }
    }

    #[test]
    fn envelope_parser_accepts_one_object_and_rejects_noise() {
        let value = parse_envelope(
            "\u{feff}{\"ok\":true,\"data\":{\"version\":\"0.4.0\"},\"meta\":{},\"warnings\":[]}",
        )
        .unwrap();
        assert_eq!(value["data"]["version"], "0.4.0");

        assert_eq!(parse_envelope("").unwrap_err().code(), "CLI_INVALID_JSON");
        assert_eq!(
            parse_envelope("not json").unwrap_err().code(),
            "CLI_INVALID_JSON"
        );
        assert_eq!(
            parse_envelope("{\"data\":{}}").unwrap_err().code(),
            "CLI_INVALID_ENVELOPE"
        );
        assert_eq!(
            parse_envelope("[]").unwrap_err().code(),
            "CLI_INVALID_ENVELOPE"
        );
    }

    #[test]
    fn auth_envelope_reader_accepts_the_extra_confirmation_document() {
        let output = "{\"ok\":true,\"data\":{\"provider\":\"gsc\"},\"meta\":{},\"warnings\":[]}\n\
                      {\"provider\":\"gsc\",\"stored\":true,\"source\":\"file\"}\n";
        assert_eq!(
            parse_envelope(output).unwrap_err().code(),
            "CLI_INVALID_JSON"
        );
        let envelope = parse_envelope_first(output).unwrap();
        assert_eq!(envelope["data"]["provider"], "gsc");
        assert_eq!(
            parse_envelope_first("not json").unwrap_err().code(),
            "CLI_INVALID_JSON"
        );
    }

    #[test]
    fn only_expected_environment_is_inherited() {
        assert!(is_inherited_env("PATH"));
        assert!(is_inherited_env("SystemRoot"));
        assert!(is_inherited_env("USERPROFILE"));
        assert!(is_inherited_env("LV24_SEO_GSC_TOKEN"));
        assert!(!is_inherited_env("AWS_SECRET_ACCESS_KEY"));
        assert!(!is_inherited_env("GITHUB_TOKEN"));
    }

    #[test]
    fn linux_keyring_environment_survives_the_allow_list() {
        // Secret Service lives on the session bus and resolves sockets under
        // XDG_RUNTIME_DIR; TMPDIR is used by the keyring crate for its socket.
        for key in [
            "DBUS_SESSION_BUS_ADDRESS",
            "XDG_RUNTIME_DIR",
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
            "XDG_CACHE_HOME",
            "TMPDIR",
        ] {
            assert!(is_inherited_env(key), "{key} must reach the engine");
        }
        // The list stays minimal: unrelated credentials are still dropped.
        assert!(!is_inherited_env("SSH_AUTH_SOCK"));
        assert!(!is_inherited_env("NPM_TOKEN"));
    }

    #[test]
    fn auth_set_argv_uses_stdin_and_never_carries_the_secret() {
        let argv = build_argv(
            CliCommandId::AuthSet,
            &CliArgs {
                provider: Some("gsc".into()),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert_eq!(
            argv,
            vec!["auth", "set", "--provider", "gsc", "--stdin", "--json"]
        );
        assert!(!argv.iter().any(|value| value.contains("secret")));
        assert!(!argv.iter().any(|value| value == "token"));
    }

    #[test]
    fn auth_providers_are_allow_listed() {
        for provider in AUTH_PROVIDERS {
            assert_eq!(
                normalize_auth_provider(provider).unwrap(),
                provider.to_string()
            );
        }
        assert_eq!(
            normalize_auth_provider("GitHub").unwrap_err().code(),
            "INVALID_ARGUMENT"
        );
        assert_eq!(
            build_argv(
                CliCommandId::AuthSet,
                &CliArgs {
                    provider: Some("unknown".into()),
                    ..CliArgs::default()
                }
            )
            .unwrap_err()
            .code(),
            "INVALID_ARGUMENT"
        );
    }

    #[test]
    fn auth_logout_argv_is_json_only() {
        let argv = build_argv(
            CliCommandId::AuthLogout,
            &CliArgs {
                provider: Some("telegram".into()),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert_eq!(
            argv,
            vec!["auth", "logout", "--provider", "telegram", "--json"]
        );
    }

    #[tokio::test]
    async fn stdin_helper_writes_the_secret_to_the_child_pipe() {
        let mut command = if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.args(["/C", "more"]);
            command
        } else {
            Command::new("cat")
        };
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command.spawn().unwrap();
        write_stdin(&mut child, b"dummy-secret-for-test")
            .await
            .unwrap();
        let output = child.wait_with_output().await.unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("dummy-secret-for-test"));
    }

    #[test]
    fn report_weekly_argv_appends_a_validated_out_directory() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("reports");
        let argv = build_argv(
            CliCommandId::ReportWeekly,
            &CliArgs {
                out: Some(out.display().to_string()),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert_eq!(
            argv,
            vec![
                "report".to_string(),
                "weekly".to_string(),
                "--days".to_string(),
                "7".to_string(),
                "--lag-days".to_string(),
                "2".to_string(),
                "--out".to_string(),
                out.display().to_string(),
                "--json".to_string(),
            ]
        );

        assert_eq!(
            build_argv(
                CliCommandId::ReportWeekly,
                &CliArgs {
                    out: Some("relative/reports".into()),
                    ..CliArgs::default()
                }
            )
            .unwrap_err()
            .code(),
            "INVALID_PATH"
        );
    }

    #[test]
    fn out_is_rejected_by_every_other_command() {
        for command in [
            CliCommandId::Version,
            CliCommandId::Stats,
            CliCommandId::ConfigShow,
            CliCommandId::Doctor,
            CliCommandId::Properties,
            CliCommandId::AuthStatus,
            CliCommandId::ReportDiff,
            CliCommandId::Crawl,
        ] {
            let error = build_argv(
                command,
                &CliArgs {
                    out: Some(std::env::temp_dir().join("reports").display().to_string()),
                    ..CliArgs::default()
                },
            )
            .unwrap_err();
            assert_eq!(error.code(), "INVALID_ARGUMENT", "{}", command.id());
        }
        for command in [CliCommandId::AuthSet, CliCommandId::AuthLogout] {
            let error = build_argv(
                command,
                &CliArgs {
                    provider: Some("gsc".into()),
                    out: Some(std::env::temp_dir().join("reports").display().to_string()),
                    ..CliArgs::default()
                },
            )
            .unwrap_err();
            assert_eq!(error.code(), "INVALID_ARGUMENT", "{}", command.id());
        }
    }

    fn hanging_command() -> Command {
        #[cfg(windows)]
        {
            let mut command = Command::new("ping");
            command.args(["-n", "30", "127.0.0.1"]);
            command
        }
        #[cfg(not(windows))]
        {
            let mut command = Command::new("sleep");
            command.arg("30");
            command
        }
    }

    /// A synthetic sidecar: it lives long enough to be killed on purpose.
    fn synthetic_child() -> tokio::process::Child {
        let mut command = hanging_command();
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        command.spawn().unwrap()
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)] // the guard is the point: one forking test at a time
    async fn the_registry_tracks_and_forgets_engine_pids() {
        let _serial = process_test_guard();
        let registry = ChildRegistry::default();
        let first = registry.track(4242);
        let second = registry.track(4243);
        assert_eq!(registry.tracked(), vec![4242, 4243]);
        drop(first);
        assert_eq!(registry.tracked(), vec![4243]);
        drop(second);
        assert!(registry.tracked().is_empty());

        // The same guard protects the process-wide registry used by real runs.
        let mut child = synthetic_child();
        let pid = child.id().unwrap();
        {
            let tracked = track_engine_child(pid);
            assert_eq!(tracked.pid, pid);
            assert!(tracked_engine_pids().contains(&pid));
        }
        assert!(!tracked_engine_pids().contains(&pid));
        let _ = child.start_kill();
        let _ = child.wait().await;
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)] // the guard is the point: one forking test at a time
    async fn a_recycled_pid_with_a_foreign_image_is_not_killed() {
        let _serial = process_test_guard();
        let registry = ChildRegistry::default();
        let mut unrelated = synthetic_child();
        let pid = unrelated.id().unwrap();
        let guard = registry.track(pid);

        let killed = stop_children(&registry, Duration::from_secs(2))
            .await
            .unwrap();

        // SEC-08: the tracked PID no longer names an engine sidecar, so it is
        // released instead of signalled.
        assert_eq!(killed, 0);
        assert!(registry.tracked().is_empty());
        assert!(
            process_alive(pid).await,
            "a foreign image must survive a stale PID entry"
        );

        let _ = unrelated.start_kill();
        let _ = unrelated.wait().await;
        drop(guard);
    }

    /// Serializes the tests that create an engine-named executable, fork it and
    /// signal it by PID. A concurrent fork can inherit a copy's write handle
    /// (ETXTBSY) and a parallel kill test can observe a recycled PID.
    static PROCESS_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn process_test_guard() -> std::sync::MutexGuard<'static, ()> {
        PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// A temp dir on the same filesystem as `/bin/sleep`, so the executable can
    /// be hard-linked instead of copied.
    fn engine_test_dir() -> tempfile::TempDir {
        #[cfg(unix)]
        {
            if let Ok(dir) = tempfile::Builder::new()
                .prefix("lv24-engine-")
                .tempdir_in("/var/tmp")
            {
                return dir;
            }
        }
        tempfile::tempdir().unwrap()
    }

    /// A real executable whose image name matches the engine's, so the identity
    /// check accepts it and the kill path is exercised. `None` means the test
    /// cannot be set up on this filesystem (the caller skips instead of falling
    /// back to a copy that races with parallel forks).
    fn engine_named_child(dir: &Path) -> Option<tokio::process::Child> {
        let exe = dir.join(crate::paths::engine_exe_name());
        let mut command = {
            #[cfg(windows)]
            {
                let root =
                    std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
                std::fs::copy(Path::new(&root).join("System32").join("ping.exe"), &exe).ok()?;
                let mut command = Command::new(&exe);
                command.args(["-n", "30", "127.0.0.1"]);
                command
            }
            #[cfg(unix)]
            {
                // Hard-link, never copy: a fresh copy has an open write handle,
                // and a concurrent fork inherits it, so `exec` fails with
                // ETXTBSY ("text file busy").
                std::fs::hard_link("/bin/sleep", &exe).ok()?;
                let mut command = Command::new(&exe);
                command.arg("30");
                // Production spawns the engine as a process-group leader
                // (`build_command`), so the test child must be one too: a
                // group kill on a non-leader is a silent no-op on Linux.
                command.process_group(0);
                command
            }
        };
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .ok()
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)] // the guard is the point: one forking test at a time
    async fn an_engine_named_tracked_child_is_stopped() {
        let _serial = process_test_guard();
        let dir = engine_test_dir();
        let registry = ChildRegistry::default();
        let Some(mut tracked) = engine_named_child(dir.path()) else {
            eprintln!(
                "skipping an_engine_named_tracked_child_is_stopped: cannot hard-link /bin/sleep \
                 into {} (cross-device temp dir)",
                dir.path().display()
            );
            return;
        };
        let pid = tracked.id().unwrap();
        // `spawn` returns before the child has necessarily exec'd: until then
        // `/proc/<pid>/exe` (and the image name) still points at the test
        // binary. Wait for the real image, then assert the name the platform
        // actually reports.
        wait_for_engine_image(pid).await;
        let image = process_image_name(pid).await.expect("image name");
        assert_eq!(
            Path::new(&image)
                .file_name()
                .and_then(|value| value.to_str()),
            Some(crate::paths::engine_exe_name()),
            "unexpected image {image}"
        );
        let guard = registry.track(pid);

        let killed = stop_children(&registry, Duration::from_secs(5))
            .await
            .unwrap();

        assert_eq!(killed, 1, "image was {image}");
        assert!(!process_alive(pid).await);

        let _ = tracked.wait().await;
        drop(guard);
    }

    /// Polls until the child reports the engine image (exec has completed).
    async fn wait_for_engine_image(pid: u32) {
        for _ in 0..300 {
            if is_engine_sidecar(pid).await {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("child {pid} never reported the engine image");
    }

    #[cfg(unix)]
    #[tokio::test]
    #[allow(clippy::await_holding_lock)] // the guard is the point: one forking test at a time
    async fn a_timeout_kills_the_grandchild_too() {
        let _serial = process_test_guard();
        let mut command = Command::new("sh");
        command
            .args(["-c", "sleep 30 & echo $!; wait"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .process_group(0);
        let mut child = command.spawn().unwrap();
        let grandchild: u32 = {
            use tokio::io::AsyncBufReadExt;
            let stdout = child.stdout.take().unwrap();
            let mut lines = tokio::io::BufReader::new(stdout).lines();
            lines
                .next_line()
                .await
                .unwrap()
                .unwrap()
                .trim()
                .parse()
                .unwrap()
        };
        assert!(process_alive(grandchild).await);

        kill_child_tree(&mut child).await;

        // SIGKILL delivery is asynchronous and the grandchild may still be a
        // zombie while init reaps it: poll instead of a single check.
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if !process_alive(grandchild).await {
                return;
            }
            if Instant::now() >= deadline {
                // PID reuse guard: only fail when the live process is still the
                // `sleep` we started, not an unrelated process that took the PID.
                let image = process_image_name(grandchild).await.unwrap_or_default();
                let name = Path::new(&image)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("");
                assert!(
                    !name.eq_ignore_ascii_case("sleep"),
                    "the interpreter started by the bootloader must not survive a timeout \
                     (pid {grandchild}, image {image})"
                );
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    #[test]
    fn previews_never_carry_a_credential() {
        let redacted = preview(r#"auth set failed: token = "sk-live-123" at line 3"#);
        assert!(!redacted.contains("sk-live-123"), "{redacted}");
        assert!(redacted.contains("***"), "{redacted}");
    }

    #[tokio::test]
    async fn engine_stderr_is_redacted_before_it_reaches_the_webview() {
        // A real child, so the test covers the whole `supervise` path: the
        // envelope on stdout and the token the engine quoted on stderr.
        let _dir = tempfile::tempdir().unwrap();
        #[cfg(windows)]
        let mut command = {
            // `cmd` would echo the backslashes of an escaped JSON argument, so
            // the envelope is read from a file instead of `echo`.
            let envelope = _dir.path().join("envelope.json");
            std::fs::write(&envelope, r#"{"ok":true}"#).unwrap();
            let mut command = Command::new("cmd");
            command.args([
                "/C",
                &format!("type {}&echo token=sk-live-123 1>&2", envelope.display()),
            ]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("sh");
            command.args([
                "-c",
                r#"printf '{"ok":true}'; printf 'token=sk-live-123\n' >&2"#,
            ]);
            command
        };
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let child = command.spawn().unwrap();

        let result = supervise(
            child,
            CliCommandId::Version,
            None,
            Duration::from_secs(10),
            Instant::now(),
            None,
        )
        .await
        .unwrap();

        assert!(!result.stderr.contains("sk-live-123"), "{}", result.stderr);
        assert!(result.stderr.contains("***"), "{}", result.stderr);
    }

    #[tokio::test]
    async fn an_empty_registry_stops_nothing() {
        let registry = ChildRegistry::default();
        assert_eq!(
            stop_children(&registry, Duration::from_secs(1))
                .await
                .unwrap(),
            0
        );
    }

    #[test]
    fn run_ids_are_bounded_ascii_keys_and_duplicates_are_refused() {
        let registry = RunRegistry::default();
        let guard = registry.begin("run-1").unwrap();
        let duplicate = registry
            .begin("run-1")
            .err()
            .expect("a duplicate run id must fail");
        assert_eq!(duplicate.code(), "RUN_ALREADY_ACTIVE");
        drop(guard);
        // The guard removed the entry: the same id can be used again.
        let guard = registry.begin("run-1").unwrap();
        drop(guard);

        let long = "x".repeat(MAX_RUN_ID_LEN + 1);
        for bad in ["", " ", "has space", "a/b", "a.b", long.as_str()] {
            let error = registry
                .begin(bad)
                .err()
                .unwrap_or_else(|| panic!("run id {bad:?} must be rejected"));
            assert_eq!(error.code(), "INVALID_ARGUMENT", "{bad:?}");
        }
        for good in ["run-1", "run_2", "0f3a9c1e-6a4b-4c1e-9f2d-7b8c9d0e1f2a"] {
            let guard = registry.begin(good).unwrap();
            drop(guard);
        }
    }

    #[test]
    fn a_finished_run_cannot_be_cancelled_and_double_cancel_is_false() {
        let registry = RunRegistry::default();

        // Finished before any cancel: refused, so the webview must not claim a
        // cancellation for a run that already produced its result.
        let finished = registry.begin("run-finished").unwrap();
        finished.mark_finished();
        assert!(matches!(
            registry.request_cancel("run-finished"),
            CancelRequest::Refused
        ));
        drop(finished);

        // Unknown or removed id: refused.
        assert!(matches!(
            registry.request_cancel("run-missing"),
            CancelRequest::Refused
        ));

        // First cancel wins, the second is refused.
        let active = registry.begin("run-active").unwrap();
        assert!(matches!(
            registry.request_cancel("run-active"),
            CancelRequest::Accepted { pid: None }
        ));
        assert!(matches!(
            registry.request_cancel("run-active"),
            CancelRequest::Refused
        ));
        // A cancel that arrived before the spawn is remembered.
        assert!(active.attach(4242));
        drop(active);
    }

    #[tokio::test]
    async fn cancel_run_rejects_invalid_ids_and_reports_an_unknown_run_as_false() {
        assert_eq!(
            cancel_run("bad id").await.unwrap_err().code(),
            "INVALID_ARGUMENT"
        );
        assert!(!cancel_run("run-that-does-not-exist").await.unwrap());
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)] // the guard is the point: one forking test at a time
    async fn a_cancelled_run_never_kills_an_unrelated_pid() {
        let _serial = process_test_guard();
        let registry = RunRegistry::default();
        let mut unrelated = synthetic_child();
        let pid = unrelated.id().unwrap();
        let guard = registry.begin("run-foreign").unwrap();
        guard.attach(pid);

        let CancelRequest::Accepted { pid: Some(tracked) } = registry.request_cancel("run-foreign")
        else {
            panic!("an active run must accept the first cancel");
        };
        assert_eq!(tracked, pid);
        assert!(
            !cancel_engine_process(tracked).await,
            "a foreign image is not an engine kill"
        );

        // SEC-08: the PID no longer names an engine sidecar, so it survives.
        assert!(
            process_alive(pid).await,
            "a foreign image must survive a run cancel"
        );

        guard.mark_finished();
        drop(guard);
        let _ = unrelated.start_kill();
        let _ = unrelated.wait().await;
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)] // the guard is the point: one forking test at a time
    async fn a_tracked_dev_engine_child_is_cancelled_with_a_non_engine_image() {
        let _serial = process_test_guard();
        let mut child = synthetic_child();
        let pid = child.id().unwrap();
        // A development engine (`LV24_SEO_BIN`) may be a Python interpreter,
        // not `lv24-seo`; the exact child registration is what makes it ours.
        let tracked = track_engine_child(pid);
        assert!(cancel_engine_process(pid).await);
        assert!(!process_alive(pid).await);
        let _ = child.wait().await;
        drop(tracked);
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)] // the guard is the point: one forking test at a time
    async fn a_cancelled_run_kills_its_exact_engine_child() {
        let _serial = process_test_guard();
        let dir = engine_test_dir();
        let Some(mut child) = engine_named_child(dir.path()) else {
            eprintln!(
                "skipping a_cancelled_run_kills_its_exact_engine_child: cannot hard-link /bin/sleep \
                 into {} (cross-device temp dir)",
                dir.path().display()
            );
            return;
        };
        let pid = child.id().unwrap();
        wait_for_engine_image(pid).await;

        let registry = RunRegistry::default();
        let guard = registry.begin("run-engine").unwrap();
        guard.attach(pid);
        let CancelRequest::Accepted { pid: Some(tracked) } = registry.request_cancel("run-engine")
        else {
            panic!("an active run must accept the first cancel");
        };
        assert_eq!(tracked, pid);
        assert!(
            cancel_engine_process(tracked).await,
            "the exact engine child must be killed"
        );

        assert!(!process_alive(pid).await);
        let _ = child.wait().await;
        drop(guard);
    }

    #[tokio::test]
    async fn the_timeout_covers_the_stdin_write_and_the_process_wait() {
        let started = Instant::now();
        let mut command = hanging_command();
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let child = command.spawn().unwrap();
        let error = supervise(
            child,
            CliCommandId::AuthSet,
            Some(b"dummy-secret"),
            Duration::from_millis(200),
            started,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(error.code(), "CLI_TIMEOUT");
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn timeouts_match_the_contract() {
        assert_eq!(CliCommandId::Stats.timeout(), Duration::from_secs(120));
        assert_eq!(
            CliCommandId::ReportWeekly.timeout(),
            Duration::from_secs(120)
        );
        assert_eq!(CliCommandId::Crawl.timeout(), Duration::from_secs(600));
        assert_eq!(CliCommandId::Doctor.timeout(), Duration::from_secs(30));
        assert_eq!(CliCommandId::Version.timeout(), Duration::from_secs(30));
        assert_eq!(CliCommandId::Init.timeout(), Duration::from_secs(60));
        assert_eq!(
            CliCommandId::SchedulePrint.timeout(),
            Duration::from_secs(30)
        );
        assert_eq!(CliCommandId::LogsAnalyze.timeout(), Duration::from_secs(60));
        assert_eq!(CliCommandId::TasksList.timeout(), Duration::from_secs(60));
        assert_eq!(CliCommandId::TasksAdd.timeout(), Duration::from_secs(60));
        assert_eq!(CliCommandId::TasksUpdate.timeout(), Duration::from_secs(60));
        assert_eq!(
            CliCommandId::BackupCreate.timeout(),
            Duration::from_secs(120)
        );
        assert_eq!(
            CliCommandId::BackupRestore.timeout(),
            Duration::from_secs(300)
        );
        assert_eq!(
            CliCommandId::PortfolioList.timeout(),
            Duration::from_secs(60)
        );
        assert_eq!(
            CliCommandId::ScheduleInstall.timeout(),
            Duration::from_secs(60)
        );
    }

    #[test]
    fn only_long_local_jobs_are_cancellable() {
        for id in [
            CliCommandId::Crawl,
            CliCommandId::ReportWeekly,
            CliCommandId::LogsAnalyze,
            CliCommandId::BackupCreate,
            CliCommandId::BackupRestore,
            CliCommandId::ScheduleInstall,
        ] {
            assert!(id.cancellable(), "{}", id.id());
        }
        for id in [
            CliCommandId::Version,
            CliCommandId::Stats,
            CliCommandId::ConfigShow,
            CliCommandId::Doctor,
            CliCommandId::Properties,
            CliCommandId::AuthStatus,
            CliCommandId::ReportDiff,
            CliCommandId::Init,
            CliCommandId::SchedulePrint,
            CliCommandId::TasksList,
            CliCommandId::TasksAdd,
            CliCommandId::TasksUpdate,
            CliCommandId::PortfolioList,
            CliCommandId::AuthSet,
            CliCommandId::AuthLogout,
        ] {
            assert!(!id.cancellable(), "{}", id.id());
        }
    }

    fn init_args(dir: &Path) -> CliArgs {
        CliArgs {
            property: Some("https://example.com".into()),
            config_path: Some(dir.join("seo.toml").display().to_string()),
            data_dir: Some(dir.join("data").display().to_string()),
            ..CliArgs::default()
        }
    }

    #[test]
    fn init_argv_is_fixed_and_always_json() {
        let dir = tempfile::tempdir().unwrap();
        let args = init_args(dir.path());
        let config = args.config_path.clone().unwrap();
        let data_dir = args.data_dir.clone().unwrap();
        let argv = build_argv(CliCommandId::Init, &args).unwrap();
        assert_eq!(
            argv.iter().map(String::as_str).collect::<Vec<_>>(),
            vec![
                "init",
                "--property",
                "https://example.com",
                "--config",
                config.as_str(),
                "--data-dir",
                data_dir.as_str(),
                "--json",
            ]
        );
        assert_eq!(CliCommandId::Init.write_kind(), WriteKind::LocalState);
    }

    #[test]
    fn init_property_accepts_urls_properties_and_bare_hosts() {
        let dir = tempfile::tempdir().unwrap();
        for (raw, expected) in [
            ("https://example.com/", "https://example.com/"),
            ("sc-domain:Example.COM", "sc-domain:example.com"),
            ("example.com/", "https://example.com"),
        ] {
            let mut args = init_args(dir.path());
            args.property = Some(raw.into());
            let argv = build_argv(CliCommandId::Init, &args).unwrap();
            assert_eq!(argv[2], expected, "{raw}");
        }
        for raw in [
            "",
            "not a host",
            "https://",
            "sc-domain:",
            "ftp://example.com",
            "example.com/path",
        ] {
            let mut args = init_args(dir.path());
            args.property = Some(raw.into());
            assert_eq!(
                build_argv(CliCommandId::Init, &args).unwrap_err().code(),
                "INVALID_ARGUMENT",
                "{raw:?}"
            );
        }
    }

    #[test]
    fn init_requires_every_argument() {
        let dir = tempfile::tempdir().unwrap();
        let base = init_args(dir.path());
        for args in [
            CliArgs {
                property: None,
                ..base.clone()
            },
            CliArgs {
                config_path: None,
                ..base.clone()
            },
            CliArgs {
                data_dir: None,
                ..base.clone()
            },
            CliArgs {
                cron: Some("0 6 * * 1".into()),
                ..base.clone()
            },
        ] {
            assert_eq!(
                build_argv(CliCommandId::Init, &args).unwrap_err().code(),
                "INVALID_ARGUMENT"
            );
        }
    }

    #[test]
    fn init_rejects_relative_network_device_and_non_toml_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        for config in [
            "relative/seo.toml".to_string(),
            root.join("seo.json").display().to_string(),
            root.join("missing").join("seo.toml").display().to_string(),
            root.join("..").join("seo.toml").display().to_string(),
            r"\\server\share\seo.toml".to_string(),
            r"\\.\PhysicalDrive0\seo.toml".to_string(),
            r"\\?\C:\tmp\seo.toml".to_string(),
        ] {
            let mut args = init_args(root);
            args.config_path = Some(config.clone());
            assert_eq!(
                build_argv(CliCommandId::Init, &args).unwrap_err().code(),
                "INVALID_PATH",
                "{config:?}"
            );
        }

        for data_dir in [
            "data".to_string(),
            root.join("missing").join("data").display().to_string(),
            r"\\server\share\data".to_string(),
        ] {
            let mut args = init_args(root);
            args.data_dir = Some(data_dir.clone());
            assert_eq!(
                build_argv(CliCommandId::Init, &args).unwrap_err().code(),
                "INVALID_PATH",
                "{data_dir:?}"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn init_rejects_reserved_windows_names() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["CON.toml", "NUL.toml", "COM1.toml", "LPT9.toml"] {
            let mut args = init_args(dir.path());
            args.config_path = Some(dir.path().join(name).display().to_string());
            assert_eq!(
                build_argv(CliCommandId::Init, &args).unwrap_err().code(),
                "INVALID_PATH",
                "{name}"
            );
        }
        let mut args = init_args(dir.path());
        args.data_dir = Some(dir.path().join("NUL").display().to_string());
        assert_eq!(
            build_argv(CliCommandId::Init, &args).unwrap_err().code(),
            "INVALID_PATH"
        );
    }

    #[test]
    fn schedule_print_argv_normalizes_cron_and_target() {
        let argv = build_argv(
            CliCommandId::SchedulePrint,
            &CliArgs {
                cron: Some("  0   6 * * 1 ".into()),
                target: Some("Windows".into()),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert_eq!(
            argv,
            vec![
                "schedule",
                "print",
                "--cron",
                "0 6 * * 1",
                "--target",
                "windows",
                "--json"
            ]
        );

        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("seo.toml");
        let config_text = config.display().to_string();
        let argv = build_argv(
            CliCommandId::SchedulePrint,
            &CliArgs {
                cron: Some("0 6 * * 1".into()),
                target: Some("systemd".into()),
                config_path: Some(config_text.clone()),
                ..CliArgs::default()
            },
        )
        .unwrap();
        assert_eq!(
            argv.iter().map(String::as_str).collect::<Vec<_>>(),
            vec![
                "schedule",
                "print",
                "--cron",
                "0 6 * * 1",
                "--target",
                "systemd",
                "--config",
                config_text.as_str(),
                "--json",
            ]
        );
    }

    #[test]
    fn schedule_print_rejects_bad_cron_and_target() {
        let long = "*".repeat(129);
        for cron in [
            "",
            "0 6 * *",
            "0 6 * * 1 2",
            "0 6 * * 1; rm -rf /",
            "0 6 * * $(id)",
            "0 6 * * 1\0",
            long.as_str(),
        ] {
            assert_eq!(
                build_argv(
                    CliCommandId::SchedulePrint,
                    &CliArgs {
                        cron: Some(cron.into()),
                        target: Some("cron".into()),
                        ..CliArgs::default()
                    }
                )
                .unwrap_err()
                .code(),
                "INVALID_ARGUMENT",
                "{cron:?}"
            );
        }
        for target in ["", "launchd", "cron;rm", "task scheduler"] {
            assert_eq!(
                build_argv(
                    CliCommandId::SchedulePrint,
                    &CliArgs {
                        cron: Some("0 6 * * 1".into()),
                        target: Some(target.into()),
                        ..CliArgs::default()
                    }
                )
                .unwrap_err()
                .code(),
                "INVALID_ARGUMENT",
                "{target:?}"
            );
        }
        for args in [
            CliArgs {
                target: Some("cron".into()),
                ..CliArgs::default()
            },
            CliArgs {
                cron: Some("0 6 * * 1".into()),
                ..CliArgs::default()
            },
        ] {
            assert_eq!(
                build_argv(CliCommandId::SchedulePrint, &args)
                    .unwrap_err()
                    .code(),
                "INVALID_ARGUMENT"
            );
        }
    }

    #[test]
    fn init_and_schedule_arguments_are_rejected_by_other_commands() {
        let config = std::env::temp_dir().join("seo.toml").display().to_string();
        let data_dir = std::env::temp_dir().join("data").display().to_string();
        let foreign = [
            CliArgs {
                property: Some("https://example.com".into()),
                ..CliArgs::default()
            },
            CliArgs {
                cron: Some("0 6 * * 1".into()),
                target: Some("cron".into()),
                ..CliArgs::default()
            },
            CliArgs {
                config_path: Some(config),
                ..CliArgs::default()
            },
            CliArgs {
                data_dir: Some(data_dir),
                ..CliArgs::default()
            },
        ];
        for command in [
            CliCommandId::Version,
            CliCommandId::Stats,
            CliCommandId::ConfigShow,
            CliCommandId::Doctor,
            CliCommandId::Properties,
            CliCommandId::AuthStatus,
            CliCommandId::ReportWeekly,
            CliCommandId::ReportDiff,
            CliCommandId::Crawl,
        ] {
            for args in &foreign {
                assert_eq!(
                    build_argv(command, args).unwrap_err().code(),
                    "INVALID_ARGUMENT",
                    "{}",
                    command.id()
                );
            }
        }
    }

    #[test]
    fn only_local_state_commands_write() {
        for command in [
            CliCommandId::Init,
            CliCommandId::TasksAdd,
            CliCommandId::TasksUpdate,
            CliCommandId::BackupCreate,
            CliCommandId::BackupRestore,
            CliCommandId::ScheduleInstall,
        ] {
            assert_eq!(
                command.write_kind(),
                WriteKind::LocalState,
                "{}",
                command.id()
            );
        }
        for command in [
            CliCommandId::Version,
            CliCommandId::Stats,
            CliCommandId::ConfigShow,
            CliCommandId::Doctor,
            CliCommandId::Properties,
            CliCommandId::AuthStatus,
            CliCommandId::ReportWeekly,
            CliCommandId::ReportDiff,
            CliCommandId::Crawl,
            CliCommandId::SchedulePrint,
            CliCommandId::LogsAnalyze,
            CliCommandId::TasksList,
            CliCommandId::PortfolioList,
            CliCommandId::AuthSet,
            CliCommandId::AuthLogout,
        ] {
            assert_eq!(command.write_kind(), WriteKind::None, "{}", command.id());
        }
    }
}
