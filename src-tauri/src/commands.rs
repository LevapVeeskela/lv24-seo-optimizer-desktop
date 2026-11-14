use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use toml_edit::DocumentMut;
use zeroize::Zeroizing;

use crate::cli::{self, CliArgs, CliCommandId};
use crate::config::{self, Patch};
use crate::error::{AppError, AppResult, ErrorInfo};
use crate::paths;
use crate::settings::{Settings, SettingsPatch, SettingsStore};

pub const MIN_ENGINE_VERSION: &str = "0.5.0";

pub struct AppState {
    pub paths: paths::AppPaths,
    pub settings: SettingsStore,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStatus {
    pub name: String,
    pub version: String,
    pub identifier: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub found: bool,
    pub path: Option<String>,
    pub source: Option<String>,
    pub version: Option<String>,
    pub minimum_version: String,
    pub compatible: bool,
    pub error: Option<ErrorInfo>,
}

impl Default for EngineStatus {
    fn default() -> Self {
        Self {
            found: false,
            path: None,
            source: None,
            version: None,
            minimum_version: MIN_ENGINE_VERSION.to_string(),
            compatible: false,
            error: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsStatus {
    pub app_config_dir: String,
    pub app_data_dir: String,
    pub log_dir: String,
    pub export_dir: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellStatus {
    pub desktop: DesktopStatus,
    pub engine: EngineStatus,
    pub config_path: Option<String>,
    pub config_exists: bool,
    pub data_dir: Option<String>,
    pub platform: String,
    pub arch: String,
    pub paths: PathsStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigReadResult {
    pub path: String,
    pub raw: String,
    pub data_dir: Option<String>,
    pub resolved_path: Option<String>,
    pub config: Option<serde_json::Value>,
    pub syntax_error: Option<String>,
    pub envelope: Option<serde_json::Value>,
    pub warnings: Vec<String>,
    pub exit_code: Option<i32>,
    pub stderr: String,
    pub engine_error: Option<ErrorInfo>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigValidateResult {
    pub path: String,
    pub valid: bool,
    pub syntax_error: Option<String>,
    pub envelope: Option<serde_json::Value>,
    pub exit_code: Option<i32>,
    pub stderr: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPatchResult {
    pub path: String,
    pub raw: String,
    pub backup: Option<String>,
    pub bytes: usize,
    pub envelope: Option<serde_json::Value>,
    pub config: Option<serde_json::Value>,
    pub warnings: Vec<String>,
    pub engine_error: Option<ErrorInfo>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTextResult {
    pub path: String,
    pub bytes: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsResponse {
    pub settings: Settings,
    pub path: String,
}

/// Startup handshake. It never fails because the engine is missing: the
/// missing/broken engine is returned as status data.
#[tauri::command]
pub async fn shell_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ShellStatus, AppError> {
    let (settings, app_paths) = {
        let state = state.inner();
        (state.settings.get(), state.paths.clone())
    };

    let config_path = settings.config_path.as_ref().map(PathBuf::from);
    let config_exists = config_path
        .as_ref()
        .map(|path| path.is_file())
        .unwrap_or(false);
    let data_dir = config_path.as_ref().and_then(|path| {
        config::read_raw(path)
            .ok()
            .and_then(|raw| raw.parse::<DocumentMut>().ok())
            .and_then(|document| config::data_dir_from_document(&document, path))
    });

    let mut engine = EngineStatus::default();
    match paths::locate_engine(&app) {
        Ok(location) => {
            engine.found = true;
            engine.path = Some(location.display_path());
            engine.source = Some(location.source.clone());
            match cli::probe_version(&location).await {
                Ok(version) => {
                    engine.compatible = version_at_least(&version, MIN_ENGINE_VERSION);
                    engine.version = Some(version);
                }
                Err(err) => engine.error = Some(err.info()),
            }
        }
        Err(err) => engine.error = Some(err.info()),
    }

    Ok(ShellStatus {
        desktop: DesktopStatus {
            name: "LV24 SEO Optimizer".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            identifier: paths::APP_IDENTIFIER.to_string(),
        },
        engine,
        config_path: config_path.map(|path| path.display().to_string()),
        config_exists,
        data_dir: data_dir.map(|path| path.display().to_string()),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        paths: PathsStatus {
            app_config_dir: app_paths.config_dir.display().to_string(),
            app_data_dir: app_paths.data_dir.display().to_string(),
            log_dir: app_paths.log_dir.display().to_string(),
            export_dir: app_paths.export_dir.display().to_string(),
        },
    })
}

/// Run one allow-listed CLI command. The webview cannot pass an executable, a
/// shell string, or unvalidated arguments. `--json` and an absolute `--config`
/// are always added by the Rust layer.
#[tauri::command(rename_all = "camelCase")]
pub async fn cli_run(
    app: AppHandle,
    state: State<'_, AppState>,
    command: String,
    args: Option<CliArgs>,
    config_path: Option<String>,
) -> Result<cli::CliRunResult, AppError> {
    let command = CliCommandId::parse(&command)?;
    let args = args.unwrap_or_default();
    let settings = state.settings.get();
    let requested_config = config_path
        .filter(|value| !value.trim().is_empty())
        .or(settings.config_path);
    let config_path = match requested_config {
        Some(raw) => {
            let path = paths::validate_config_path(&raw)?;
            if command.requires_config() && !path.is_file() {
                return Err(AppError::new(
                    "CONFIG_NOT_FOUND",
                    format!("config file not found: {}", path.display()),
                ));
            }
            Some(path)
        }
        None if command.requires_config() => {
            // `version` is the only allow-listed command that may run before a
            // config exists (shell_status uses the same handshake).
            return Err(AppError::new(
                "CONFIG_PATH_REQUIRED",
                format!("{} requires an absolute config path", command.id()),
            ));
        }
        None => None,
    };

    let location = paths::locate_engine(&app)?;
    cli::run(&location, config_path.as_deref(), command, &args).await
}

/// Store a provider secret through stdin. The secret is never placed in argv,
/// logged, or returned; it is zeroized after the engine exits.
#[tauri::command(rename_all = "camelCase")]
pub async fn auth_set(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: String,
    secret: String,
    config_path: Option<String>,
) -> Result<cli::CliRunResult, AppError> {
    let secret = Zeroizing::new(secret);
    let provider = cli::normalize_auth_provider(&provider)?;
    if secret.trim().is_empty() {
        return Err(AppError::new("INVALID_ARGUMENT", "secret is empty"));
    }
    if secret.len() > 64 * 1024 {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "secret is larger than 64 KiB",
        ));
    }
    if secret
        .chars()
        .any(|ch| ch == '\n' || ch == '\r' || ch == '\0')
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "secret must not contain line breaks or NUL",
        ));
    }
    let config_path = resolve_required_config(state.inner(), config_path)?;
    let location = paths::locate_engine(&app)?;
    let args = CliArgs {
        provider: Some(provider),
        ..CliArgs::default()
    };
    cli::run_with_stdin(
        &location,
        Some(&config_path),
        CliCommandId::AuthSet,
        &args,
        Some(secret.as_bytes()),
    )
    .await
}

/// Remove a stored secret (`auth logout`). It never reads a secret value.
#[tauri::command(rename_all = "camelCase")]
pub async fn auth_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: String,
    config_path: Option<String>,
) -> Result<cli::CliRunResult, AppError> {
    let provider = cli::normalize_auth_provider(&provider)?;
    let config_path = resolve_required_config(state.inner(), config_path)?;
    let location = paths::locate_engine(&app)?;
    let args = CliArgs {
        provider: Some(provider),
        ..CliArgs::default()
    };
    cli::run(
        &location,
        Some(&config_path),
        CliCommandId::AuthLogout,
        &args,
    )
    .await
}

/// Apply settings-form patches to the raw TOML, validate the draft with the
/// engine, back up, and atomically replace. Comments and key order survive.
#[tauri::command(rename_all = "camelCase")]
pub async fn config_patch(
    app: AppHandle,
    path: String,
    patches: Vec<Patch>,
) -> Result<ConfigPatchResult, AppError> {
    let target = paths::validate_config_path(&path)?;
    if !target.is_file() {
        return Err(AppError::new(
            "CONFIG_NOT_FOUND",
            format!("config file not found: {}", target.display()),
        ));
    }
    let raw = config::read_raw(&target)?;
    let mut document = config::parse_toml(&raw)?;
    config::apply_patches(&mut document, &patches)?;
    let new_raw = document.to_string();
    if new_raw.len() as u64 > config::MAX_CONFIG_BYTES {
        return Err(AppError::new(
            "CONFIG_PATCH",
            format!(
                "patched config is larger than {} bytes",
                config::MAX_CONFIG_BYTES
            ),
        ));
    }

    let location = paths::locate_engine(&app)?;
    let validation = config::validate_with_engine(&location, &target, &new_raw).await?;
    if !validation.valid {
        return Err(AppError::new(
            "CONFIG_INVALID",
            "patched configuration did not pass `lv24-seo config show`",
        )
        .with_details(serde_json::json!({
            "path": target.display().to_string(),
            "exitCode": validation.exit_code,
            "envelope": validation.envelope,
            "stderr": validation.stderr,
        })));
    }

    let (backup, bytes) = if new_raw == raw {
        (
            None,
            fs::metadata(&target)
                .map(|meta| meta.len() as usize)
                .unwrap_or(0),
        )
    } else {
        let temp = config::stage_temp(&target, &new_raw)?;
        match config::commit_temp(&temp, &target) {
            Ok(outcome) => (outcome.backup, outcome.bytes),
            Err(err) => {
                let _ = fs::remove_file(&temp);
                return Err(err);
            }
        }
    };

    let config = validation
        .envelope
        .pointer("/data/config")
        .filter(|value| value.is_object())
        .cloned();
    let warnings = envelope_warnings(&validation.envelope);
    let mut result = ConfigPatchResult {
        path: target.display().to_string(),
        raw: new_raw,
        backup,
        bytes,
        envelope: Some(validation.envelope),
        config,
        warnings,
        engine_error: None,
    };
    match cli::run(
        &location,
        Some(&target),
        CliCommandId::ConfigShow,
        &CliArgs::default(),
    )
    .await
    {
        Ok(run) => {
            result.warnings = envelope_warnings(&run.envelope);
            result.config = run
                .envelope
                .pointer("/data/config")
                .filter(|value| value.is_object())
                .cloned();
            result.envelope = Some(run.envelope);
        }
        Err(err) => result.engine_error = Some(err.info()),
    }
    Ok(result)
}

/// Write an export only under the app/project config and data roots. The
/// active config and desktop settings files are reserved for their own
/// validated commands.
#[tauri::command(rename_all = "camelCase")]
pub fn write_text_file(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<WriteTextResult, AppError> {
    const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;
    if content.len() > MAX_EXPORT_BYTES {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "export content is larger than 64 MiB",
        ));
    }
    let requested = paths::validate_absolute_path(&path, "export")?;
    ensure_export_target(&requested)?;
    let settings = state.settings.get();
    if let Some(config_path) = settings.config_path.as_deref() {
        if same_path(&requested, &PathBuf::from(config_path)) {
            return Err(AppError::new(
                "PATH_NOT_ALLOWED",
                "the active config must be changed with config_write/config_patch",
            ));
        }
    }
    if same_path(&requested, state.settings.path()) {
        return Err(AppError::new(
            "PATH_NOT_ALLOWED",
            "desktop settings are reserved for settings_set",
        ));
    }
    let roots = vec![state.paths.export_dir.clone()];
    let target = paths::ensure_write_within_roots(&requested, &roots)?;
    let outcome = config::write_text_atomic(&target, &content)?;
    Ok(WriteTextResult {
        path: requested.display().to_string(),
        bytes: outcome.bytes,
    })
}

/// Raw TOML plus the redacted effective config from
/// `lv24-seo config show --json`.
#[tauri::command]
pub async fn config_read(app: AppHandle, path: String) -> Result<ConfigReadResult, AppError> {
    let config_path = paths::validate_config_path(&path)?;
    if !config_path.is_file() {
        return Err(AppError::new(
            "CONFIG_NOT_FOUND",
            format!("config file not found: {}", config_path.display()),
        ));
    }

    let raw = config::read_raw(&config_path)?;
    let mut result = ConfigReadResult {
        path: config_path.display().to_string(),
        raw: raw.clone(),
        data_dir: None,
        resolved_path: None,
        config: None,
        syntax_error: None,
        envelope: None,
        warnings: Vec::new(),
        exit_code: None,
        stderr: String::new(),
        engine_error: None,
    };

    match config::parse_toml(&raw) {
        Ok(document) => {
            result.data_dir = config::data_dir_from_document(&document, &config_path)
                .map(|path| path.display().to_string());
        }
        Err(err) => result.syntax_error = Some(err.message()),
    }

    match paths::locate_engine(&app) {
        Ok(location) => {
            match cli::run(
                &location,
                Some(&config_path),
                CliCommandId::ConfigShow,
                &CliArgs::default(),
            )
            .await
            {
                Ok(run) => {
                    result.exit_code = run.exit_code;
                    result.stderr = run.stderr;
                    result.warnings = envelope_warnings(&run.envelope);
                    result.resolved_path = run
                        .envelope
                        .pointer("/data/path")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string);
                    result.config = run
                        .envelope
                        .pointer("/data/config")
                        .filter(|value| value.is_object())
                        .cloned();
                    if let Some(data_dir) = run
                        .envelope
                        .pointer("/data/data_dir")
                        .and_then(serde_json::Value::as_str)
                    {
                        result.data_dir = Some(
                            config::resolve_data_dir(data_dir, &config_path)
                                .display()
                                .to_string(),
                        );
                    }
                    result.envelope = Some(run.envelope);
                }
                Err(err) => result.engine_error = Some(err.info()),
            }
        }
        Err(err) => result.engine_error = Some(err.info()),
    }

    Ok(result)
}

/// Validate a draft without touching the real file.
#[tauri::command]
pub async fn config_validate(
    app: AppHandle,
    path: String,
    content: String,
) -> Result<ConfigValidateResult, AppError> {
    let target = paths::validate_config_path(&path)?;
    if content.len() as u64 > config::MAX_CONFIG_BYTES {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!(
                "config content is larger than {} bytes",
                config::MAX_CONFIG_BYTES
            ),
        ));
    }

    if let Err(err) = config::parse_toml(&content) {
        return Ok(ConfigValidateResult {
            path: target.display().to_string(),
            valid: false,
            syntax_error: Some(err.message()),
            envelope: None,
            exit_code: None,
            stderr: String::new(),
        });
    }

    let location = paths::locate_engine(&app)?;
    let outcome = config::validate_with_engine(&location, &target, &content).await?;
    Ok(ConfigValidateResult {
        path: target.display().to_string(),
        valid: outcome.valid,
        syntax_error: None,
        envelope: Some(outcome.envelope),
        exit_code: outcome.exit_code,
        stderr: outcome.stderr,
    })
}

/// Validate a draft, back up the current file, then atomically replace it.
#[tauri::command]
pub async fn config_write(
    app: AppHandle,
    path: String,
    content: String,
) -> Result<config::WriteOutcome, AppError> {
    let target = paths::validate_config_path(&path)?;
    if content.len() as u64 > config::MAX_CONFIG_BYTES {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!(
                "config content is larger than {} bytes",
                config::MAX_CONFIG_BYTES
            ),
        ));
    }
    config::parse_toml(&content)?;

    let location = paths::locate_engine(&app)?;
    let validation = config::validate_with_engine(&location, &target, &content).await?;
    if !validation.valid {
        return Err(AppError::new(
            "CONFIG_INVALID",
            "configuration did not pass `lv24-seo config show`",
        )
        .with_details(serde_json::json!({
            "path": target.display().to_string(),
            "exitCode": validation.exit_code,
            "envelope": validation.envelope,
            "stderr": validation.stderr,
        })));
    }

    let temp = config::stage_temp(&target, &content)?;
    match config::commit_temp(&temp, &target) {
        Ok(outcome) => Ok(outcome),
        Err(err) => {
            let _ = fs::remove_file(&temp);
            Err(err)
        }
    }
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> SettingsResponse {
    SettingsResponse {
        settings: state.settings.get(),
        path: state.settings.path().display().to_string(),
    }
}

#[tauri::command]
pub fn settings_set(
    state: State<'_, AppState>,
    settings: SettingsPatch,
) -> Result<SettingsResponse, AppError> {
    let updated = settings.apply_to(state.settings.get());
    let settings = state.settings.set(updated)?;
    Ok(SettingsResponse {
        settings,
        path: state.settings.path().display().to_string(),
    })
}

/// Open a report/folder only when it lives under the app config/data dirs or
/// the selected project's config/data dirs.
#[tauri::command]
pub fn open_path(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<(), AppError> {
    let roots = allowed_roots(state.inner());
    let requested = paths::validate_absolute_path(&path, "open")?;
    let canonical = paths::ensure_within_roots(&requested, &roots)?;
    ensure_open_target(&canonical)?;
    app.opener()
        .open_path(requested.to_string_lossy().to_string(), None::<&str>)
        .map_err(|err| {
            AppError::new(
                "OPEN_PATH",
                format!("cannot open {}: {err}", requested.display()),
            )
        })
}

fn resolve_required_config(state: &AppState, requested: Option<String>) -> AppResult<PathBuf> {
    let raw = requested
        .filter(|value| !value.trim().is_empty())
        .or_else(|| state.settings.get().config_path)
        .ok_or_else(|| {
            AppError::new(
                "CONFIG_PATH_REQUIRED",
                "an absolute config path is required",
            )
        })?;
    let path = paths::validate_config_path(&raw)?;
    if !path.is_file() {
        return Err(AppError::new(
            "CONFIG_NOT_FOUND",
            format!("config file not found: {}", path.display()),
        ));
    }
    Ok(path)
}

fn allowed_roots(state: &AppState) -> Vec<PathBuf> {
    let settings = state.settings.get();
    let mut roots = vec![
        state.paths.config_dir.clone(),
        state.paths.data_dir.clone(),
        state.paths.log_dir.clone(),
        state.paths.export_dir.clone(),
    ];
    if let Some(raw) = &settings.config_path {
        let config_path = PathBuf::from(raw);
        if let Some(parent) = config_path.parent() {
            if parent.parent().is_some() {
                roots.push(parent.to_path_buf());
            }
        }
        if let Ok(raw) = config::read_raw(&config_path) {
            if let Ok(document) = raw.parse::<DocumentMut>() {
                if let Some(data_dir) = config::data_dir_from_document(&document, &config_path) {
                    if data_dir.parent().is_some() {
                        roots.push(data_dir);
                    }
                }
            }
        }
    }
    roots
}

fn same_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy().to_lowercase() == right.to_string_lossy().to_lowercase()
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

const OPENABLE_EXTENSIONS: &[&str] = &[
    "html", "htm", "json", "md", "txt", "csv", "toml", "log", "sqlite", "sqlite3", "db", "pdf",
    "png", "jpg", "jpeg", "webp",
];

const EXPORT_EXTENSIONS: &[&str] = &[
    "json", "md", "txt", "csv", "html", "htm", "toml", "log", "yaml", "yml", "xml",
];

const RESERVED_EXPORT_NAMES: &[&str] = &["secrets.json", "settings.json", "seo.toml"];

fn ensure_export_target(path: &Path) -> AppResult<()> {
    ensure_extension(path, EXPORT_EXTENSIONS, "export")?;
    ensure_not_reserved(path, RESERVED_EXPORT_NAMES)?;
    Ok(())
}

fn ensure_open_target(path: &Path) -> AppResult<()> {
    ensure_extension(path, OPENABLE_EXTENSIONS, "open")?;
    ensure_not_reserved(path, &["secrets.json"])?;
    Ok(())
}

fn ensure_not_reserved(path: &Path, reserved: &[&str]) -> AppResult<()> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if reserved.contains(&name.as_str()) {
        return Err(AppError::new(
            "PATH_NOT_ALLOWED",
            format!("{} is reserved for the app or the engine", path.display()),
        ));
    }
    Ok(())
}

/// Prevent `open_path`/`write_text_file` from becoming a script launcher.
fn ensure_extension(path: &Path, allowed: &[&str], label: &str) -> AppResult<()> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if path.is_dir() {
        // macOS application bundles are directories but execute code when
        // opened; do not let `open_path` launch them.
        if matches!(
            extension.as_str(),
            "app" | "bundle" | "pkg" | "framework" | "xcodeproj" | "playground"
        ) {
            return Err(AppError::new(
                "PATH_NOT_ALLOWED",
                format!(
                    "{label} does not allow application bundles: {}",
                    path.display()
                ),
            ));
        }
        return Ok(());
    }
    if allowed.contains(&extension.as_str()) {
        Ok(())
    } else {
        Err(AppError::new(
            "PATH_NOT_ALLOWED",
            format!("{label} does not allow the file type of {}", path.display()),
        )
        .with_details(serde_json::json!({
            "path": path.display().to_string(),
            "allowedExtensions": allowed,
        })))
    }
}

fn envelope_warnings(envelope: &serde_json::Value) -> Vec<String> {
    envelope
        .get("warnings")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn version_at_least(candidate: &str, minimum: &str) -> bool {
    match (parse_semver(candidate), parse_semver(minimum)) {
        (Some(candidate), Some(minimum)) => candidate >= minimum,
        _ => false,
    }
}

fn parse_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let core = raw.trim().split(['-', '+']).next().unwrap_or("");
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_version_comparison_is_numeric() {
        assert!(version_at_least("0.4.0", "0.4.0"));
        assert!(version_at_least("0.4.1", "0.4.0"));
        assert!(version_at_least("0.10.0", "0.4.0"));
        assert!(!version_at_least("0.3.9", "0.4.0"));
        assert!(!version_at_least("not-a-version", "0.4.0"));
    }

    #[test]
    fn semver_ignores_prerelease_and_build_metadata() {
        assert_eq!(parse_semver("1.2.3-rc.1"), Some((1, 2, 3)));
        assert_eq!(parse_semver("1.2.3+build.5"), Some((1, 2, 3)));
        assert_eq!(parse_semver("1.2"), None);
    }

    #[test]
    fn envelope_warnings_are_extracted() {
        let envelope = serde_json::json!({
            "ok": true,
            "data": {},
            "meta": {},
            "warnings": ["one", 2, "two"]
        });
        assert_eq!(envelope_warnings(&envelope), vec!["one", "two"]);
        assert!(envelope_warnings(&serde_json::json!({"ok": true})).is_empty());
    }

    #[test]
    fn open_and_export_extensions_reject_scripts() {
        assert!(ensure_extension(Path::new("report.html"), OPENABLE_EXTENSIONS, "open").is_ok());
        assert!(ensure_open_target(Path::new("report.html")).is_ok());
        assert_eq!(
            ensure_open_target(Path::new("secrets.json"))
                .unwrap_err()
                .code(),
            "PATH_NOT_ALLOWED"
        );
        assert!(ensure_extension(Path::new("report.json"), EXPORT_EXTENSIONS, "export").is_ok());
        assert!(ensure_export_target(Path::new("report.json")).is_ok());
        assert_eq!(
            ensure_export_target(Path::new("secrets.json"))
                .unwrap_err()
                .code(),
            "PATH_NOT_ALLOWED"
        );
        assert_eq!(
            ensure_export_target(Path::new("data.sqlite3"))
                .unwrap_err()
                .code(),
            "PATH_NOT_ALLOWED"
        );
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("Fake.app");
        fs::create_dir(&bundle).unwrap();
        assert_eq!(
            ensure_extension(&bundle, OPENABLE_EXTENSIONS, "open")
                .unwrap_err()
                .code(),
            "PATH_NOT_ALLOWED"
        );
        assert!(ensure_extension(dir.path(), OPENABLE_EXTENSIONS, "open").is_ok());
        for name in ["evil.cmd", "evil.ps1", "evil.exe", "evil.bat", "evil.js"] {
            assert_eq!(
                ensure_extension(Path::new(name), OPENABLE_EXTENSIONS, "open")
                    .unwrap_err()
                    .code(),
                "PATH_NOT_ALLOWED"
            );
            assert_eq!(
                ensure_extension(Path::new(name), EXPORT_EXTENSIONS, "export")
                    .unwrap_err()
                    .code(),
                "PATH_NOT_ALLOWED"
            );
        }
    }
}
