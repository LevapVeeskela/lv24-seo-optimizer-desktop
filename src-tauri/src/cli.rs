use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::paths::{validate_absolute_path, EngineLocation};

/// Upper bounds keep a runaway engine from exhausting webview memory.
const MAX_STDOUT: usize = 4 * 1024 * 1024;
const MAX_STDERR: usize = 128 * 1024;

const DEFAULT_DAYS: u32 = 7;
const DEFAULT_LAG_DAYS: u32 = 2;

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
    /// Internal commands used by dedicated auth commands; they are deliberately
    /// absent from the generic `cli_run` allow-list.
    AuthSet,
    AuthLogout,
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
            other => Err(AppError::new(
                "INVALID_COMMAND",
                format!("command {other:?} is not in the desktop allow-list"),
            )
            .with_details(serde_json::json!({
                "allowed": [
                    "version", "stats", "config_show", "doctor", "properties",
                    "auth_status", "report_weekly", "report_diff", "crawl"
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
            Self::AuthSet => "auth_set",
            Self::AuthLogout => "auth_delete",
        }
    }

    /// Commands that need an existing project config file. `version`, `stats`,
    /// `doctor`, `properties` and `auth_status` may run without one; `auth_set`
    /// and `auth_delete` are reached through their dedicated commands.
    pub fn requires_config(self) -> bool {
        matches!(
            self,
            Self::ConfigShow | Self::ReportWeekly | Self::ReportDiff | Self::Crawl
        )
    }

    pub fn timeout(self) -> Duration {
        match self {
            Self::Crawl => Duration::from_secs(600),
            Self::AuthSet | Self::AuthLogout => Duration::from_secs(120),
            Self::Stats | Self::ReportWeekly | Self::ReportDiff => Duration::from_secs(120),
            // A cold PyInstaller sidecar can spend well over ten seconds on
            // unpacking and antivirus scanning before it prints a version.
            Self::Version => Duration::from_secs(30),
            Self::ConfigShow | Self::Doctor | Self::Properties | Self::AuthStatus => {
                Duration::from_secs(30)
            }
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
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
}

pub const AUTH_PROVIDERS: &[&str] = &["gsc", "yandex", "bing", "crux", "psi", "smtp", "telegram"];

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
            {
                return reject("base/head/start/maxUrls/provider/out");
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
            {
                return reject("base/head/start/maxUrls/provider");
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
            {
                return reject("days/lagDays/start/maxUrls/provider/out");
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
            {
                return reject("days/lagDays/base/head/provider/out");
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
            {
                return reject("days/lagDays/base/head/start/maxUrls/out");
            }
            if args.provider.is_none() {
                return Err(AppError::new(
                    "INVALID_ARGUMENT",
                    "provider is required for auth commands",
                ));
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
    let trimmed = value.trim();
    if trimmed.len() > 2048 {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "start URL is longer than 2048 characters",
        ));
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "start URL must not contain whitespace or control characters",
        ));
    }
    let rest = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .ok_or_else(|| {
            AppError::new(
                "INVALID_ARGUMENT",
                format!("start URL must use http or https, got {trimmed:?}"),
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
            format!("start URL has an invalid host: {trimmed:?}"),
        ));
    }
    Ok(trimmed)
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
    ];
    let upper = key.to_ascii_uppercase();
    ALLOWED.contains(&upper.as_str()) || upper.starts_with("LV24_SEO_")
}

pub async fn run(
    location: &EngineLocation,
    config_path: Option<&Path>,
    command: CliCommandId,
    args: &CliArgs,
) -> AppResult<CliRunResult> {
    run_with_stdin(location, config_path, command, args, None).await
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
    let argv = build_argv(command, args)?;
    let mut prepared = build_command(location, config_path, &argv)?;
    if stdin_data.is_some() {
        prepared.stdin(Stdio::piped());
    }
    let started = Instant::now();
    let child = prepared.spawn().map_err(|err| {
        AppError::new(
            "ENGINE_SPAWN",
            format!(
                "cannot start lv24-seo at {}: {err}",
                location.path.display()
            ),
        )
    })?;
    supervise(child, command, stdin_data, command.timeout(), started).await
}

/// Collect one engine run under a single timeout budget. `started` is recorded
/// before the spawn so `duration_ms` covers the whole run, and the same budget
/// bounds both the stdin write and the process wait.
async fn supervise(
    mut child: tokio::process::Child,
    command: CliCommandId,
    stdin_data: Option<&[u8]>,
    timeout: Duration,
    started: Instant,
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
                let _ = child.start_kill();
                let _ = child.wait().await;
                stdout_task.abort();
                stderr_task.abort();
                return Err(err);
            }
            Err(_) => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                stdout_task.abort();
                stderr_task.abort();
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
            return Err(AppError::new(
                "ENGINE_WAIT",
                format!("engine process failed: {err}"),
            ));
        }
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            stdout_task.abort();
            stderr_task.abort();
            return Err(timeout_error(command, timeout));
        }
    };

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
        stderr: stderr_text,
        duration_ms: started.elapsed().as_millis() as u64,
        truncated: stdout_truncated || stderr_truncated,
    })
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
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
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
        ] {
            assert_eq!(CliCommandId::parse(id).unwrap().id(), id);
        }
        for id in ["shell", "rm", "auth_set", "report_send", ""] {
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
        assert!(is_inherited_env("LV24_SEO_GSC_TOKEN"));
        assert!(!is_inherited_env("AWS_SECRET_ACCESS_KEY"));
        assert!(!is_inherited_env("GITHUB_TOKEN"));
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
    }
}
