use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use toml_edit::DocumentMut;
use zeroize::Zeroizing;

use crate::cli::{self, CliArgs, CliCommandId};
use crate::config::{self, Patch};
use crate::error::{AppError, AppResult, ErrorInfo};
use crate::paths;
use crate::settings::{Settings, SettingsPatch, SettingsStore};

/// 0.9.2 ships engine 0.14.0 and adds the read-only Indexing automation card. The card needs
/// engine 0.13.1 for `indexing status/history` and `schedule status`; the 0.14.0 OAuth readiness
/// diagnostics are surfaced by `auth status`/`doctor`. An older sidecar returns a typed command
/// error instead of a fake success. The bundle also relies on the 0.13.0 OAuth connectors, the
/// 0.12.0 indexing reads, the 0.11.0 diagnostics screen, the 0.10.0 `bing submit` write, the 0.9.0
/// `sitemap submit` (Bing only) and `indexnow submit --from-sitemap`, the 0.8.0
/// `schedule install --allow-write` opt-in and on `backup restore`, `portfolio list` and the `cwv`
/// report section (engine 0.7.0).
pub const MIN_ENGINE_VERSION: &str = "0.14.0";

/// Progress event emitted by the Rust updater while it downloads a release.
pub const UPDATE_PROGRESS_EVENT: &str = "update://progress";
/// How often a running download checks the cancellation flag.
const UPDATE_CANCEL_POLL: Duration = Duration::from_millis(100);
/// Canonicalizing a path on a dead network share can block for the SMB
/// timeout; the UI must get an answer before that.
const PATH_RESOLVE_TIMEOUT: Duration = Duration::from_secs(10);
const SETTINGS_WRITE_TIMEOUT: Duration = Duration::from_secs(10);
const EXPORT_WRITE_TIMEOUT: Duration = Duration::from_secs(30);
/// Bing Site Scan has no public API. The desktop may only open this exact page;
/// the user starts the scan there.
const BING_SITE_SCAN_URL: &str = "https://www.bing.com/webmasters/sitescan";
const BING_SITE_SCAN_QUERY: &str = "?siteUrl=";
const MAX_SITE_URL_LEN: usize = 2048;
/// The only URL `open_oauth_url` may open: the Yandex consent page. The engine
/// returns this URL from `auth login --url-only`; nothing else is accepted.
const OAUTH_YANDEX_AUTHORIZE_URL: &str = "https://oauth.yandex.ru/authorize";
const MAX_OAUTH_URL_LEN: usize = 8192;

/// 32 random bytes rendered as 64 lowercase hex characters. `getrandom` uses
/// the OS CSPRNG (BCryptGenRandom, getrandom(2), SecRandomCopyBytes).
fn generate_write_secret() -> AppResult<String> {
    use std::fmt::Write as _;

    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|err| {
        AppError::new(
            "WRITE_SECRET",
            format!("cannot generate the session write secret: {err}"),
        )
    })?;
    let mut secret = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        // Writing to a String cannot fail.
        let _ = write!(secret, "{byte:02x}");
    }
    Ok(secret)
}

pub struct AppState {
    pub paths: paths::AppPaths,
    pub settings: Arc<SettingsStore>,
    /// Config files the user picked in the native dialog. `settings_set` may
    /// only activate one of these (or the already-active path).
    approved_configs: Mutex<HashSet<PathBuf>>,
    /// Folders the user picked in the native directory dialog. `init` may only
    /// create a config in one of these or next to the current config.
    approved_directories: Mutex<HashSet<PathBuf>>,
    /// Access logs the user picked in the native file dialog. `logs_analyze`
    /// reads only one of these or a file under the app data/export roots.
    approved_log_files: Mutex<HashSet<PathBuf>>,
    /// Backup archives the user picked in the native file dialog.
    /// `backup_restore` reads only one of these.
    approved_backup_archives: Mutex<HashSet<PathBuf>>,
    /// Per-app-session write-gate secret. Generated from the OS CSPRNG at
    /// startup, kept in memory only and passed to engine children as
    /// `LV24_SEO_WRITE_SECRET`; never persisted, logged or returned to the
    /// webview. A new session intentionally invalidates old plan tokens.
    write_secret: Zeroizing<String>,
    update: UpdateGate,
}

impl AppState {
    pub fn new(paths: paths::AppPaths, settings: SettingsStore) -> AppResult<Self> {
        Ok(Self {
            paths,
            settings: Arc::new(settings),
            approved_configs: Mutex::new(HashSet::new()),
            approved_directories: Mutex::new(HashSet::new()),
            approved_log_files: Mutex::new(HashSet::new()),
            approved_backup_archives: Mutex::new(HashSet::new()),
            write_secret: Zeroizing::new(generate_write_secret()?),
            update: UpdateGate::default(),
        })
    }

    /// Secret handed to every engine child for the write gate. Borrowed only
    /// for the spawn; it is never serialized into a status or result type.
    pub fn write_secret(&self) -> &str {
        self.write_secret.as_str()
    }

    fn approved_configs(&self) -> MutexGuard<'_, HashSet<PathBuf>> {
        self.approved_configs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn approved_directories(&self) -> MutexGuard<'_, HashSet<PathBuf>> {
        self.approved_directories
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn approved_log_files(&self) -> MutexGuard<'_, HashSet<PathBuf>> {
        self.approved_log_files
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn approved_backup_archives(&self) -> MutexGuard<'_, HashSet<PathBuf>> {
        self.approved_backup_archives
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Record a config path the user chose in the native dialog and return its
    /// canonical form. The webview never gets to name a path that did not come
    /// from this dialog.
    pub fn approve_config(&self, path: &Path) -> AppResult<PathBuf> {
        let validated = paths::validate_config_path(&path.display().to_string())?;
        // The canonical form is only used for the comparison: the webview and
        // the settings file keep the normalized path the user picked.
        let canonical = fs::canonicalize(&validated).unwrap_or_else(|_| validated.clone());
        self.approved_configs().insert(canonical);
        // Persist the known list so recent workspaces survive a restart. The
        // in-process approval above already lets `settings_set` proceed, so a
        // settings write failure is logged instead of failing the dialog.
        if let Err(err) = self.settings.remember_config(&validated) {
            log::warn!("cannot persist known config {}: {err}", validated.display());
        }
        Ok(validated)
    }

    fn is_config_approved(&self, candidate: &Path) -> bool {
        let approved = self.approved_configs();
        if approved.contains(candidate) {
            return true;
        }
        match fs::canonicalize(candidate) {
            Ok(canonical) => approved.iter().any(|path| same_path(path, &canonical)),
            Err(_) => approved.iter().any(|path| same_path(path, candidate)),
        }
    }

    /// A config path persisted by an earlier `pick_config`/`init`. The file is
    /// not required to exist here; `ensure_config_path_allowed` reports
    /// `CONFIG_NOT_FOUND` for a known path that was deleted.
    fn is_config_known(&self, candidate: &Path) -> bool {
        let settings = self.settings.get();
        // The common case is the exact stored spelling: answer without any
        // filesystem call, so a mapped drive in the list cannot stall the UI.
        if settings
            .known_configs
            .iter()
            .any(|known| same_path(Path::new(known), candidate))
        {
            return true;
        }
        let Ok(canonical) = fs::canonicalize(candidate) else {
            return false;
        };
        settings.known_configs.iter().any(|known| {
            fs::canonicalize(known)
                .map(|path| same_path(&path, &canonical))
                .unwrap_or(false)
        })
    }

    /// Record a folder chosen in the native directory dialog. The canonical
    /// form is stored for comparisons; the webview gets the normalized path it
    /// picked so it can join `seo.toml` and `data` without a verbatim prefix.
    pub fn approve_directory(&self, path: &Path) -> AppResult<PathBuf> {
        let validated = paths::validate_directory_path(&path.display().to_string(), "directory")?;
        let canonical = fs::canonicalize(&validated).map_err(|err| {
            AppError::new(
                "INVALID_PATH",
                format!("cannot resolve {}: {err}", validated.display()),
            )
        })?;
        self.approved_directories().insert(canonical);
        Ok(validated)
    }

    fn is_directory_approved(&self, directory: &Path) -> bool {
        let approved = self.approved_directories();
        match fs::canonicalize(directory) {
            Ok(canonical) => approved.iter().any(|path| same_path(path, &canonical)),
            Err(_) => approved.iter().any(|path| same_path(path, directory)),
        }
    }

    /// Record an access log chosen in the native file dialog. The canonical
    /// form is stored for comparisons; the webview gets the normalized path it
    /// picked so the engine receives a plain absolute path.
    pub fn approve_log_file(&self, path: &Path) -> AppResult<PathBuf> {
        let validated = paths::validate_log_file_path(&path.display().to_string(), "log file")?;
        let canonical = fs::canonicalize(&validated).map_err(|err| {
            AppError::new(
                "INVALID_PATH",
                format!("cannot resolve {}: {err}", validated.display()),
            )
        })?;
        self.approved_log_files().insert(canonical);
        Ok(validated)
    }

    fn is_log_file_approved(&self, candidate: &Path) -> bool {
        let approved = self.approved_log_files();
        match fs::canonicalize(candidate) {
            Ok(canonical) => approved.iter().any(|path| same_path(path, &canonical)),
            Err(_) => approved.iter().any(|path| same_path(path, candidate)),
        }
    }

    /// Record a backup archive chosen in the native file dialog. The canonical
    /// form is stored for comparisons; the webview gets the normalized path the
    /// user picked so the engine receives a plain absolute path.
    pub fn approve_backup_archive(&self, path: &Path) -> AppResult<PathBuf> {
        let validated = paths::validate_backup_archive_path(&path.display().to_string())?;
        let canonical = fs::canonicalize(&validated).map_err(|err| {
            AppError::new(
                "INVALID_PATH",
                format!("cannot resolve {}: {err}", validated.display()),
            )
        })?;
        self.approved_backup_archives().insert(canonical);
        Ok(validated)
    }

    fn is_backup_archive_approved(&self, candidate: &Path) -> bool {
        let approved = self.approved_backup_archives();
        match fs::canonicalize(candidate) {
            Ok(canonical) => approved.iter().any(|path| same_path(path, &canonical)),
            Err(_) => approved.iter().any(|path| same_path(path, candidate)),
        }
    }

    /// `backup restore` reads exactly one local archive. It must come from
    /// `pick_backup_archive` in this process; an arbitrary webview string is
    /// rejected before the engine is spawned.
    fn ensure_backup_archive_allowed(&self, raw: &str) -> AppResult<PathBuf> {
        let validated = paths::validate_backup_archive_path(raw)?;
        if self.is_backup_archive_approved(&validated) {
            return Ok(validated);
        }
        Err(AppError::new(
            "PATH_NOT_APPROVED",
            "choose the backup archive with the native file dialog",
        )
        .with_details(serde_json::json!({
            "path": validated.display().to_string(),
        })))
    }

    /// `portfolio list` scans the project folders under one root. The root must
    /// be a directory the user picked in the native dialog; read-only is not a
    /// reason to let a compromised webview enumerate the filesystem.
    fn ensure_portfolio_root_allowed(&self, raw: &str) -> AppResult<PathBuf> {
        let directory = paths::validate_directory_path(raw, "portfolio root")?;
        if self.is_directory_approved(&directory) {
            return Ok(directory);
        }
        Err(AppError::new(
            "PATH_NOT_APPROVED",
            "choose the portfolio folder with the native directory dialog",
        )
        .with_details(serde_json::json!({
            "path": directory.display().to_string(),
        })))
    }

    /// `logs analyze` reads exactly one local file. It must either come from
    /// `pick_log_file` in this process or live under the app's own data/export
    /// directories; an arbitrary webview string is rejected before the engine
    /// is spawned.
    fn ensure_log_file_allowed(&self, raw: &str) -> AppResult<PathBuf> {
        let validated = paths::validate_log_file_path(raw, "log file")?;
        let roots = [self.paths.data_dir.clone(), self.paths.export_dir.clone()];
        if paths::ensure_within_roots(&validated, &roots).is_ok() {
            return Ok(validated);
        }
        if self.is_log_file_approved(&validated) {
            return Ok(validated);
        }
        Err(AppError::new(
            "PATH_NOT_APPROVED",
            "choose the access log with the native file dialog",
        )
        .with_details(serde_json::json!({
            "path": validated.display().to_string(),
            "roots": roots.iter().map(|root| root.display().to_string()).collect::<Vec<_>>(),
        })))
    }

    /// `backup create` writes one zip. The destination must be the app export
    /// directory (or a child of it) or a folder picked in the native directory
    /// dialog; an arbitrary existing folder is not enough.
    fn ensure_backup_out_allowed(&self, raw: &str) -> AppResult<PathBuf> {
        let directory = paths::validate_directory_path(raw, "backup output")?;
        let roots = [self.paths.export_dir.clone()];
        if paths::ensure_dir_within_roots(&directory, &roots).is_ok() {
            return Ok(directory);
        }
        if self.is_directory_approved(&directory) {
            return Ok(directory);
        }
        Err(AppError::new(
            "PATH_NOT_APPROVED",
            "choose the backup folder with the native directory dialog",
        )
        .with_details(serde_json::json!({
            "path": directory.display().to_string(),
            "exportDir": self.paths.export_dir.display().to_string(),
        })))
    }

    /// `init` writes local files. Its config may only be created in a folder
    /// the user picked in the native dialog or next to the current config;
    /// otherwise a compromised webview could drop a config anywhere.
    fn ensure_init_parent_approved(&self, config: &Path) -> AppResult<()> {
        let parent = config.parent().ok_or_else(|| {
            AppError::new(
                "INVALID_PATH",
                format!("config path has no parent: {}", config.display()),
            )
        })?;
        if self.is_directory_approved(parent) {
            return Ok(());
        }
        let current = self.settings.get();
        if let Some(active) = current.config_path.as_deref() {
            if let Some(active_parent) = Path::new(active).parent() {
                if same_path(parent, active_parent) {
                    return Ok(());
                }
            }
        }
        Err(AppError::new(
            "PATH_NOT_APPROVED",
            "choose the project folder with the native directory dialog",
        )
        .with_details(serde_json::json!({
            "path": config.display().to_string(),
            "parent": parent.display().to_string(),
        })))
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum UpdatePhase {
    #[default]
    Idle,
    Downloading,
    Installing,
    Done,
}

#[derive(Default)]
struct UpdateGateState {
    phase: UpdatePhase,
    cancelled: bool,
}

/// Serializes the Rust-side update: one download/install at a time, and a
/// cancellation that is observed before the installer is started.
#[derive(Default)]
struct UpdateGate {
    inner: Mutex<UpdateGateState>,
}

impl UpdateGate {
    fn lock(&self) -> MutexGuard<'_, UpdateGateState> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn begin(&self) -> AppResult<()> {
        let mut inner = self.lock();
        if matches!(
            inner.phase,
            UpdatePhase::Downloading | UpdatePhase::Installing
        ) {
            return Err(AppError::new(
                "UPDATE_IN_PROGRESS",
                "an update is already being downloaded or installed",
            ));
        }
        inner.phase = UpdatePhase::Downloading;
        inner.cancelled = false;
        Ok(())
    }

    /// `true` when the download was cancelled before the installer started.
    fn cancel(&self) -> bool {
        let mut inner = self.lock();
        if inner.phase != UpdatePhase::Downloading {
            return false;
        }
        inner.cancelled = true;
        true
    }

    fn is_cancelled(&self) -> bool {
        self.lock().cancelled
    }

    fn start_install(&self) -> bool {
        let mut inner = self.lock();
        if inner.cancelled {
            return false;
        }
        inner.phase = UpdatePhase::Installing;
        true
    }

    fn finish(&self, installed: bool) {
        let mut inner = self.lock();
        inner.phase = if installed {
            UpdatePhase::Done
        } else {
            UpdatePhase::Idle
        };
        inner.cancelled = false;
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallResult {
    pub version: String,
    pub installed: bool,
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
    /// Installed bundle type: deb, rpm, appimage, msi, nsis, app or unknown.
    pub bundle_kind: String,
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

/// Stop every engine sidecar this app instance spawned before the updater
/// replaces files. A live sidecar keeps `engine/lv24-seo/lv24-seo.exe` locked,
/// which is what broke the 0.2.1 install. Only exact tracked PIDs are killed;
/// nothing is matched by image name, so another installed copy, a portable
/// build, or an unrelated process is untouched. Returns the number killed.
#[tauri::command]
pub async fn prepare_update() -> Result<u32, AppError> {
    let tracked = cli::tracked_engine_pids();
    if tracked.is_empty() {
        return Ok(0);
    }
    log::info!("prepare_update: stopping tracked engine sidecar(s) {tracked:?}");
    let killed = cli::stop_tracked_children(cli::ENGINE_STOP_WAIT).await?;
    log::info!("prepare_update: stopped {killed} engine sidecar process(es)");
    Ok(killed)
}

/// Download and install the announced release from the Rust side.
///
/// The webview can no longer call `downloadAndInstall` itself: it has no
/// `updater:*` permission, so `prepare_update` (stop sidecars) and this
/// re-check cannot be bypassed. The announced version must still be the one the
/// user saw; a changed endpoint answer is a hard error, not a silent upgrade.
#[tauri::command(rename_all = "camelCase")]
pub async fn update_install(
    app: AppHandle,
    state: State<'_, AppState>,
    expected_version: String,
) -> Result<UpdateInstallResult, AppError> {
    let expected = expected_version.trim().to_string();
    if expected.is_empty() {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "expectedVersion is empty",
        ));
    }
    state.update.begin()?;
    // Defense in depth: the webview calls `prepare_update` first, but the
    // installer must never replace a file a tracked sidecar still locks.
    cli::stop_tracked_children(cli::ENGINE_STOP_WAIT).await?;
    let outcome = install_update(&app, &state.update, &expected).await;
    state.update.finish(outcome.is_ok());
    outcome
}

/// Cancel a running download. Returns `false` once the installer has started:
/// at that point the update cannot be undone and the UI must say so instead of
/// pretending the click cancelled it.
#[tauri::command]
pub fn update_cancel(state: State<'_, AppState>) -> bool {
    state.update.cancel()
}

async fn install_update(
    app: &AppHandle,
    gate: &UpdateGate,
    expected: &str,
) -> AppResult<UpdateInstallResult> {
    let updater = app.updater().map_err(|err| {
        AppError::new(
            "UPDATE_UNAVAILABLE",
            format!("the updater is not configured: {err}"),
        )
    })?;
    let update = updater
        .check()
        .await
        .map_err(|err| AppError::new("UPDATE_CHECK", format!("cannot check for updates: {err}")))?;
    let Some(update) = update else {
        return Err(AppError::new(
            "UPDATE_NOT_AVAILABLE",
            "no update is available",
        ));
    };
    if update.version != expected {
        return Err(AppError::new(
            "UPDATE_VERSION_MISMATCH",
            format!(
                "the announced release is {} but {expected} was requested",
                update.version
            ),
        )
        .with_details(serde_json::json!({
            "announced": update.version,
            "expected": expected,
        })));
    }

    let mut downloaded = 0u64;
    let emitter = app.clone();
    let mut download = Box::pin(update.download(
        move |len: usize, content_length: Option<u64>| {
            downloaded = downloaded.saturating_add(len as u64);
            let _ = emitter.emit(
                UPDATE_PROGRESS_EVENT,
                UpdateProgress {
                    downloaded,
                    total: content_length,
                },
            );
        },
        || {},
    ));
    let bytes = loop {
        tokio::select! {
            result = &mut download => break result.map_err(|err| {
                AppError::new("UPDATE_INSTALL", format!("cannot download the update: {err}"))
            })?,
            _ = tokio::time::sleep(UPDATE_CANCEL_POLL) => {
                // Dropping the download future closes the HTTP stream, so a
                // cancelled update is never installed.
                if gate.is_cancelled() {
                    return Err(AppError::new(
                        "UPDATE_CANCELLED",
                        "the update download was cancelled",
                    ));
                }
            }
        }
    };
    if !gate.start_install() {
        return Err(AppError::new(
            "UPDATE_CANCELLED",
            "the update download was cancelled",
        ));
    }
    let _ = app.emit(
        UPDATE_PROGRESS_EVENT,
        UpdateProgress {
            downloaded: bytes.len() as u64,
            total: Some(bytes.len() as u64),
        },
    );
    update.install(&bytes).map_err(|err| {
        AppError::new(
            "UPDATE_INSTALL",
            format!("cannot install the update: {err}"),
        )
    })?;
    Ok(UpdateInstallResult {
        version: update.version.clone(),
        installed: true,
    })
}

/// Open the native file dialog and remember the chosen config. This is the
/// only way a new `seo.toml` may become the active project config, so a
/// workspace config cannot redirect `config_write` to an arbitrary file.
#[tauri::command]
pub async fn pick_config(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let picked = app
        .dialog()
        .file()
        .set_title("seo.toml")
        .add_filter("TOML", &["toml"])
        .blocking_pick_file();
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|err| {
        AppError::new(
            "INVALID_PATH",
            format!("cannot resolve the picked file: {err}"),
        )
    })?;
    let approved = state.approve_config(&path)?;
    Ok(Some(approved.display().to_string()))
}

/// Open the native directory dialog and remember the chosen folder. `init` may
/// only create a config inside an approved folder, so the folder always comes
/// from the OS dialog and never from a webview-supplied string.
#[tauri::command]
pub async fn pick_directory(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let picked = app
        .dialog()
        .file()
        .set_title("Project folder")
        .blocking_pick_folder();
    let Some(folder) = picked else {
        return Ok(None);
    };
    let path = folder.into_path().map_err(|err| {
        AppError::new(
            "INVALID_PATH",
            format!("cannot resolve the picked folder: {err}"),
        )
    })?;
    let approved = state.approve_directory(&path)?;
    Ok(Some(approved.display().to_string()))
}

/// Open the native file dialog for one access log and remember the canonical
/// file. `logs_analyze` only reads a file approved this way or one under the
/// app data/export roots, so the webview cannot turn the engine into an
/// arbitrary file reader.
#[tauri::command]
pub async fn pick_log_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let picked = app
        .dialog()
        .file()
        .set_title("Access log")
        .blocking_pick_file();
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|err| {
        AppError::new(
            "INVALID_PATH",
            format!("cannot resolve the picked log file: {err}"),
        )
    })?;
    let approved = state.approve_log_file(&path)?;
    Ok(Some(approved.display().to_string()))
}

/// Open the native file dialog for one backup archive and remember the
/// canonical file. `backup_restore` only reads a file approved this way, so the
/// webview cannot turn the engine into an arbitrary zip reader.
#[tauri::command]
pub async fn pick_backup_archive(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let picked = app
        .dialog()
        .file()
        .set_title("Backup archive")
        .add_filter("Backup archive", &["zip"])
        .blocking_pick_file();
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|err| {
        AppError::new(
            "INVALID_PATH",
            format!("cannot resolve the picked archive: {err}"),
        )
    })?;
    let approved = state.approve_backup_archive(&path)?;
    Ok(Some(approved.display().to_string()))
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
    let data_dir = config_path.as_ref().and_then(|path| safe_data_dir(path));

    let mut engine = EngineStatus::default();
    match paths::locate_engine(&app) {
        Ok(location) => {
            engine.found = true;
            engine.path = Some(location.display_path());
            engine.source = Some(location.source.clone());
            match cli::probe_version(&location, state.write_secret()).await {
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
        bundle_kind: tauri::utils::platform::bundle_type()
            .map(|kind| kind.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
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
/// are always added by the Rust layer, and a requested config may only name the
/// project config selected in Settings.
#[tauri::command(rename_all = "camelCase")]
pub async fn cli_run(
    app: AppHandle,
    state: State<'_, AppState>,
    command: String,
    args: Option<CliArgs>,
    config_path: Option<String>,
    run_id: Option<String>,
) -> Result<cli::CliRunResult, AppError> {
    let command = CliCommandId::parse(&command)?;
    let mut args = args.unwrap_or_default();
    let requested_config = config_path;

    if command == CliCommandId::Init {
        // `init` creates a config that is not active yet; the destination is
        // `args.configPath`. A top-level `configPath` is accepted as an alias
        // only when both name the same file.
        if let Some(top_level) = requested_config
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            match args.config_path.as_deref() {
                Some(from_args) if !same_path(Path::new(from_args), Path::new(top_level)) => {
                    return Err(AppError::new(
                        "INVALID_ARGUMENT",
                        "args.configPath and configPath name different files",
                    ));
                }
                None => args.config_path = Some(top_level.clone()),
                Some(_) => {}
            }
        }
    }

    if command == CliCommandId::PortfolioList
        && requested_config
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        // A portfolio roll-up spans projects; it never uses the active config.
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "portfolio_list does not use a project config",
        ));
    }
    let config_path = if matches!(
        command,
        CliCommandId::Init | CliCommandId::LogsAnalyze | CliCommandId::PortfolioList
    ) {
        // `init` targets a config that is not active yet; `logs analyze` reads
        // one local file and must keep working even when the workspace config
        // is stale or missing; `portfolio list` scans a picked root.
        None
    } else {
        resolve_active_config_opt(state.inner(), requested_config)?
    };
    let config_path = match (config_path, command.requires_config()) {
        (Some(path), true) => {
            if !path.is_file() {
                return Err(AppError::new(
                    "CONFIG_NOT_FOUND",
                    format!("config file not found: {}", path.display()),
                ));
            }
            Some(path)
        }
        (Some(path), false) => Some(path),
        (None, true) => {
            // Only the commands in `CliCommandId::requires_config` need a
            // project config; version/stats/doctor/properties/auth_status may
            // run before onboarding finishes.
            return Err(AppError::new(
                "CONFIG_PATH_REQUIRED",
                format!("{} requires an absolute config path", command.id()),
            ));
        }
        (None, false) => None,
    };
    let init_target = if command == CliCommandId::Init {
        let target = args
            .config_path
            .as_deref()
            .ok_or_else(|| AppError::new("INVALID_ARGUMENT", "configPath is required for init"))?;
        let target = paths::validate_init_config_path(target)?;
        state.ensure_init_parent_approved(&target)?;
        Some(target)
    } else {
        None
    };
    if matches!(
        command,
        CliCommandId::SchedulePrint | CliCommandId::ScheduleInstall
    ) {
        // Both schedule commands act on the active project. A requested path
        // must already be the active one; it is passed to the engine through
        // args so `--config` appears once in argv.
        let active = config_path.as_ref().ok_or_else(|| {
            AppError::new(
                "CONFIG_PATH_REQUIRED",
                format!("{} requires an absolute config path", command.id()),
            )
        })?;
        if let Some(requested) = args.config_path.as_deref() {
            let requested = paths::validate_config_path(requested)?;
            if !same_path(&requested, active) {
                return Err(AppError::new(
                    "PATH_NOT_ALLOWED",
                    "the requested config is not the active project config selected in Settings",
                )
                .with_details(serde_json::json!({
                    "requested": requested.display().to_string(),
                    "active": active.display().to_string(),
                })));
            }
        }
        args.config_path = Some(active.display().to_string());
    }
    if command == CliCommandId::ReportWeekly {
        args.out = Some(
            report_output_dir(state.inner(), args.out.take())?
                .display()
                .to_string(),
        );
    }
    if command == CliCommandId::LogsAnalyze {
        let file = args.file.as_deref().ok_or_else(|| {
            AppError::new("INVALID_ARGUMENT", "file is required for logs_analyze")
        })?;
        let allowed = state.inner().ensure_log_file_allowed(file)?;
        args.file = Some(allowed.display().to_string());
    }
    if command == CliCommandId::BackupCreate {
        let out = args.out.as_deref().ok_or_else(|| {
            AppError::new("INVALID_ARGUMENT", "out is required for backup_create")
        })?;
        let allowed = state.inner().ensure_backup_out_allowed(out)?;
        args.out = Some(allowed.display().to_string());
    }
    if command == CliCommandId::BackupRestore {
        // The plan phase must stay read-only: a token is the only thing that
        // can turn this call into an apply, and build_argv rejects a token
        // without the explicit opt-in.
        let file = args.file.as_deref().ok_or_else(|| {
            AppError::new("INVALID_ARGUMENT", "file is required for backup_restore")
        })?;
        let allowed = state.inner().ensure_backup_archive_allowed(file)?;
        args.file = Some(allowed.display().to_string());
        let active = config_path.as_ref().ok_or_else(|| {
            AppError::new(
                "CONFIG_PATH_REQUIRED",
                "backup_restore requires an absolute config path",
            )
        })?;
        if let Some(requested) = args.config_path.as_deref() {
            let requested = paths::validate_config_path(requested)?;
            if !same_path(&requested, active) {
                return Err(AppError::new(
                    "PATH_NOT_ALLOWED",
                    "the requested config is not the active project config selected in Settings",
                )
                .with_details(serde_json::json!({
                    "requested": requested.display().to_string(),
                    "active": active.display().to_string(),
                })));
            }
        }
        args.config_path = Some(active.display().to_string());
    }
    if matches!(
        command,
        CliCommandId::SitemapSubmit
            | CliCommandId::IndexNowSubmit
            | CliCommandId::BingSubmit
            | CliCommandId::BingSitemaps
            | CliCommandId::BingIssues
            | CliCommandId::BingQuota
    ) {
        // The Bing write gate is bound to the selected workspace: the engine
        // opens the ledger next to this config, so a webview-supplied path must
        // never redirect it. The read-only Bing views read the same project.
        // The plan phase carries no token; the apply phase carries both flags
        // only after the confirmation dialog.
        let active = config_path.as_ref().ok_or_else(|| {
            AppError::new(
                "CONFIG_PATH_REQUIRED",
                format!("{} requires an absolute config path", command.id()),
            )
        })?;
        if let Some(requested) = args.config_path.as_deref() {
            let requested = paths::validate_config_path(requested)?;
            if !same_path(&requested, active) {
                return Err(AppError::new(
                    "PATH_NOT_ALLOWED",
                    "the requested config is not the active project config selected in Settings",
                )
                .with_details(serde_json::json!({
                    "requested": requested.display().to_string(),
                    "active": active.display().to_string(),
                })));
            }
        }
        args.config_path = Some(active.display().to_string());
    }
    if command == CliCommandId::PortfolioList {
        let root = args.root.as_deref().ok_or_else(|| {
            AppError::new("INVALID_ARGUMENT", "root is required for portfolio_list")
        })?;
        let allowed = state.inner().ensure_portfolio_root_allowed(root)?;
        args.root = Some(allowed.display().to_string());
    }

    // `init`, the schedule commands, `backup_restore` and the indexing commands
    // carry `--config` in argv; every other command gets it appended by the
    // runner. `logs analyze` and `portfolio list` have no `--config` option.
    let engine_config = match command {
        CliCommandId::Init
        | CliCommandId::SchedulePrint
        | CliCommandId::ScheduleInstall
        | CliCommandId::BackupRestore
        | CliCommandId::SitemapSubmit
        | CliCommandId::IndexNowSubmit
        | CliCommandId::BingSubmit
        | CliCommandId::BingSitemaps
        | CliCommandId::BingIssues
        | CliCommandId::BingQuota
        | CliCommandId::LogsAnalyze
        | CliCommandId::PortfolioList => None,
        _ => config_path.as_deref(),
    };
    let location = paths::locate_engine(&app)?;
    let write_secret = state.inner().write_secret();
    let result = match run_id.as_deref() {
        // A run id is the webview's cancellation handle. It is only accepted
        // for long local jobs (`CliCommandId::cancellable`); a short read keeps
        // the plain synchronous path.
        Some(run_id) => {
            cli::run_tracked(
                &location,
                engine_config,
                command,
                &args,
                run_id,
                write_secret,
            )
            .await?
        }
        None => cli::run(&location, engine_config, command, &args, write_secret).await?,
    };
    if let Some(target) = init_target {
        // `init` created the file: approve it now so the wizard can call
        // `settings_set` without another dialog, and persist it for the next
        // start. A recording failure must not turn a created project into an
        // error response.
        let created = result
            .envelope
            .get("ok")
            .and_then(serde_json::Value::as_bool)
            == Some(true)
            && target.is_file();
        if created {
            if let Err(err) = state.approve_config(&target) {
                log::warn!(
                    "cannot record the config created by init at {}: {err}",
                    target.display()
                );
            }
        }
    }
    Ok(result)
}

/// Cancel one active long-running engine call by its stable run id.
///
/// `false` means the run already finished (or the id is unknown): the webview
/// must not show a cancelled state in that case. Only the exact child tracked
/// for this run is signalled; no process is matched by name.
#[tauri::command(rename_all = "camelCase")]
pub async fn run_cancel(run_id: String) -> Result<bool, AppError> {
    cli::cancel_run(&run_id).await
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
    let config_path = resolve_active_config(state.inner(), config_path)?;
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
        state.inner().write_secret(),
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
    let config_path = resolve_active_config(state.inner(), config_path)?;
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
        state.inner().write_secret(),
    )
    .await
}

/// Apply settings-form patches to the raw TOML, validate the draft with the
/// engine, back up, and atomically replace. Comments and key order survive.
#[tauri::command(rename_all = "camelCase")]
pub async fn config_patch(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
    patches: Vec<Patch>,
) -> Result<ConfigPatchResult, AppError> {
    let target = resolve_active_config(state.inner(), path)?;
    if !target.is_file() {
        return Err(AppError::new(
            "CONFIG_NOT_FOUND",
            format!("config file not found: {}", target.display()),
        ));
    }
    let raw = config::read_raw(&target)?;
    let mut document = config::parse_toml(&raw)?;
    config::apply_patches(&mut document, &patches)?;
    ensure_local_data_dir(&document, &target)?;
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
    let validation =
        config::validate_with_engine(&location, &target, &new_raw, state.inner().write_secret())
            .await?;
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
        state.inner().write_secret(),
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
/// validated commands. The write runs off the UI thread: a 64 MiB export or a
/// dead network share must not freeze the window.
#[tauri::command(rename_all = "camelCase")]
pub async fn write_text_file(
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
    let app_paths = state.paths.clone();
    let settings = state.settings.get();
    let settings_path = state.settings.path().to_path_buf();
    spawn_blocking_with_timeout("export write", EXPORT_WRITE_TIMEOUT, move || {
        ensure_export_target(&requested)?;
        if let Some(config_path) = settings.config_path.as_deref() {
            if same_path(&requested, &PathBuf::from(config_path)) {
                return Err(AppError::new(
                    "PATH_NOT_ALLOWED",
                    "the active config must be changed with config_write/config_patch",
                ));
            }
        }
        if same_path(&requested, &settings_path) {
            return Err(AppError::new(
                "PATH_NOT_ALLOWED",
                "desktop settings are reserved for settings_set",
            ));
        }
        let roots = vec![app_paths.export_dir.clone()];
        let target = paths::ensure_write_within_roots(&requested, &roots)?;
        // Re-check the resolved target: an 8.3 alias or a junction can name a
        // file the raw string did not spell out, so the reserved/extension
        // checks must run on what will actually be written.
        ensure_export_target(&target)?;
        let outcome = config::write_text_atomic(&target, &content)?;
        Ok(WriteTextResult {
            path: requested.display().to_string(),
            bytes: outcome.bytes,
        })
    })
    .await
}

/// Raw TOML plus the redacted effective config from
/// `lv24-seo config show --json`.
#[tauri::command]
pub async fn config_read(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<ConfigReadResult, AppError> {
    let config_path = resolve_active_config(state.inner(), path)?;
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
                .ok()
                .flatten()
                .filter(|path| !paths::is_unsafe_share_reference(&path.to_string_lossy()))
                .map(|path| path.display().to_string());
        }
        Err(err) => result.syntax_error = Some(redacted_syntax_error(&err)),
    }

    match paths::locate_engine(&app) {
        Ok(location) => {
            match cli::run(
                &location,
                Some(&config_path),
                CliCommandId::ConfigShow,
                &CliArgs::default(),
                state.inner().write_secret(),
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
                        let resolved = config::resolve_data_dir(data_dir, &config_path);
                        // The engine may have accepted a share from a config
                        // written by another tool; never surface it.
                        if !paths::is_unsafe_share_reference(&resolved.to_string_lossy()) {
                            result.data_dir = Some(resolved.display().to_string());
                        }
                    }
                    if let Some(error) = envelope_error(&run.envelope) {
                        result.engine_error = Some(error);
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
    state: State<'_, AppState>,
    path: Option<String>,
    content: String,
) -> Result<ConfigValidateResult, AppError> {
    let target = resolve_active_config(state.inner(), path)?;
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
            // A TOML error quotes the offending line, which can be a token the
            // user pasted before the syntax error was fixed.
            syntax_error: Some(redacted_syntax_error(&err)),
            envelope: None,
            exit_code: None,
            stderr: String::new(),
        });
    }

    let location = paths::locate_engine(&app)?;
    let fallback_dir = state.paths.config_dir.clone();
    let outcome = config::validate_with_engine_in(
        &location,
        &target,
        &content,
        Some(fallback_dir.as_path()),
        state.inner().write_secret(),
    )
    .await?;
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
    state: State<'_, AppState>,
    path: Option<String>,
    content: String,
) -> Result<config::WriteOutcome, AppError> {
    let target = resolve_active_config(state.inner(), path)?;
    if content.len() as u64 > config::MAX_CONFIG_BYTES {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!(
                "config content is larger than {} bytes",
                config::MAX_CONFIG_BYTES
            ),
        ));
    }
    let document = config::parse_toml(&content)?;
    ensure_local_data_dir(&document, &target)?;

    let location = paths::locate_engine(&app)?;
    let validation =
        config::validate_with_engine(&location, &target, &content, state.inner().write_secret())
            .await?;
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
pub async fn settings_set(
    state: State<'_, AppState>,
    settings: SettingsPatch,
) -> Result<SettingsResponse, AppError> {
    let current = state.settings.get();
    let updated = settings.apply_to(current.clone());
    ensure_config_path_allowed(&state, &current, &updated)?;
    let store = Arc::clone(&state.settings);
    spawn_blocking_with_timeout("settings write", SETTINGS_WRITE_TIMEOUT, move || {
        let settings = store.set(updated)?;
        Ok(SettingsResponse {
            settings,
            path: store.path().display().to_string(),
        })
    })
    .await
}

/// Open a report/folder only when it lives under the app config/data dirs or
/// the selected project's config/data dirs. The canonical path is resolved off
/// the UI thread and opened instead of the raw request: a symlink or an
/// executable handler swapped in after the check must not be launched.
#[tauri::command]
pub async fn open_path(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), AppError> {
    let requested = paths::validate_absolute_path(&path, "open")?;
    let app_paths = state.paths.clone();
    let settings = state.settings.get();
    let canonical = spawn_blocking_with_timeout("open path", PATH_RESOLVE_TIMEOUT, move || {
        let roots = allowed_roots(&app_paths, &settings);
        let canonical = paths::ensure_within_roots(&requested, &roots)?;
        ensure_open_target(&canonical)?;
        Ok(canonical)
    })
    .await?;
    app.opener()
        .open_path(
            opener_path(&canonical).to_string_lossy().to_string(),
            None::<&str>,
        )
        .map_err(|err| {
            AppError::new(
                "OPEN_PATH",
                format!("cannot open {}: {err}", canonical.display()),
            )
        })
}

/// Windows `fs::canonicalize` returns a verbatim path (`\\?\C:\...`). The
/// check must use it, but shell-execution APIs reject that prefix, so the
/// opener receives the same file without it. No re-resolution happens here.
fn opener_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy();
        if let Some(rest) = raw.strip_prefix(r"\\?\") {
            // `\\?\C:\...` -> `C:\...`; `\\?\UNC\...` stays verbatim because a
            // plain UNC path is not allowed anywhere in this shell.
            let bytes = rest.as_bytes();
            if bytes.len() > 2 && bytes[1] == b':' {
                return PathBuf::from(rest);
            }
        }
        path.to_path_buf()
    }
    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

/// Open Bing Site Scan in the default browser.
///
/// Bing exposes no public API for starting a Site Scan, so this command never
/// claims to start one. The destination host and path are hard-coded; the only
/// variable is an absolute `https://` site URL placed in the `siteUrl` query
/// parameter. The webview cannot pass a destination URL.
#[tauri::command(rename_all = "camelCase")]
pub fn open_bing_sitescan(app: AppHandle, site_url: String) -> Result<String, AppError> {
    let url = bing_sitescan_url(&site_url)?;
    app.opener()
        .open_url(url.clone(), None::<&str>)
        .map_err(|err| {
            AppError::new(
                "OPEN_URL",
                format!("cannot open the Bing Site Scan page: {err}"),
            )
        })?;
    Ok(url)
}

/// Build the only URL this command may open. `siteUrl` is percent-encoded with
/// the RFC 3986 unreserved set, so no extra query parameter, fragment or path
/// can be injected through the site URL.
fn bing_sitescan_url(site_url: &str) -> AppResult<String> {
    let site = validate_bing_site_url(site_url)?;
    let url = format!(
        "{BING_SITE_SCAN_URL}{BING_SITE_SCAN_QUERY}{}",
        encode_query_component(site)
    );
    ensure_bing_sitescan_destination(&url)?;
    Ok(url)
}

fn validate_bing_site_url(raw: &str) -> AppResult<&str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new("INVALID_ARGUMENT", "siteUrl is empty"));
    }
    if trimmed.len() > MAX_SITE_URL_LEN {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("siteUrl is longer than {MAX_SITE_URL_LEN} characters"),
        ));
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "siteUrl must not contain whitespace or control characters",
        ));
    }
    let rest = trimmed.strip_prefix("https://").ok_or_else(|| {
        AppError::new(
            "INVALID_ARGUMENT",
            format!("siteUrl must be an absolute https URL, got {trimmed:?}"),
        )
    })?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty()
        || authority.starts_with(':')
        || authority.contains('@')
        || authority.contains('\\')
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("siteUrl has an invalid host: {trimmed:?}"),
        ));
    }
    Ok(trimmed)
}

/// Percent-encode one query value. Only unreserved characters survive, so a
/// site URL cannot add `&`, `#`, `?` or a path segment to the destination.
fn encode_query_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

/// Defense in depth: the opener is only ever handed the hard-coded Bing page
/// with exactly one `siteUrl` parameter.
fn ensure_bing_sitescan_destination(url: &str) -> AppResult<()> {
    let prefix = format!("{BING_SITE_SCAN_URL}{BING_SITE_SCAN_QUERY}");
    let Some(query) = url.strip_prefix(&prefix) else {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "refusing to open a URL outside the Bing Site Scan page",
        ));
    };
    if query.is_empty()
        || query.contains('&')
        || query.contains('#')
        || query.contains('?')
        || query.contains('\\')
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "refusing to open a malformed Bing Site Scan URL",
        ));
    }
    Ok(())
}

/// Open the Yandex OAuth consent page returned by `auth login --url-only`.
///
/// This is deliberately not a generic URL opener: the scheme, host and path are
/// fixed to `https://oauth.yandex.ru/authorize`, the query must be non-empty and
/// a fragment, userinfo or backslash is refused. Google's loopback flow is
/// opened by the engine itself, so it never reaches this command.
#[tauri::command(rename_all = "camelCase")]
pub fn open_oauth_url(app: AppHandle, url: String) -> Result<String, AppError> {
    let url = validate_oauth_authorize_url(&url)?.to_string();
    app.opener()
        .open_url(url.clone(), None::<&str>)
        .map_err(|err| {
            AppError::new(
                "OPEN_URL",
                format!("cannot open the Yandex authorization page: {err}"),
            )
        })?;
    Ok(url)
}

fn validate_oauth_authorize_url(raw: &str) -> AppResult<&str> {
    let value = raw.trim();
    if value.is_empty() {
        return Err(AppError::new("INVALID_ARGUMENT", "url is empty"));
    }
    if value.len() > MAX_OAUTH_URL_LEN {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("url is longer than {MAX_OAUTH_URL_LEN} characters"),
        ));
    }
    if value
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "url must not contain whitespace or control characters",
        ));
    }
    let rest = value.strip_prefix("https://").ok_or_else(|| {
        AppError::new(
            "INVALID_ARGUMENT",
            format!("url must be an absolute https URL, got {value:?}"),
        )
    })?;
    let (authority, path) = rest
        .split_once('/')
        .map(|(authority, path)| (authority, format!("/{path}")))
        .unwrap_or((rest, String::new()));
    if !authority.eq_ignore_ascii_case("oauth.yandex.ru") {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            format!("refusing to open a URL outside oauth.yandex.ru: {value:?}"),
        ));
    }
    let Some(query) = path.strip_prefix("/authorize?") else {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "refusing to open a URL outside the Yandex authorize page",
        ));
    };
    if query.is_empty() || query.contains('#') || query.contains('\\') {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "refusing to open a malformed Yandex authorize URL",
        ));
    }
    // Defense in depth: the composed prefix must still be the fixed page.
    if !value.starts_with(&format!("{OAUTH_YANDEX_AUTHORIZE_URL}?")) {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "refusing to open a URL outside the Yandex authorize page",
        ));
    }
    Ok(value)
}

/// SEC-05: a config path may only become active when it equals the current one,
/// came from the native dialog in this process, or is a path the user already
/// picked/created in an earlier run (persisted `known_configs`). Otherwise any
/// `.toml` on disk could be made the target of `config_write`/`config_patch`.
/// A known path whose file is gone is `CONFIG_NOT_FOUND`, not "unapproved".
fn ensure_config_path_allowed(
    state: &AppState,
    current: &Settings,
    updated: &Settings,
) -> AppResult<()> {
    if updated.config_path == current.config_path {
        return Ok(());
    }
    let Some(requested) = updated.config_path.as_deref() else {
        // Clearing the selection is always allowed.
        return Ok(());
    };
    let validated = paths::validate_config_path(requested)?;
    // The same file may be spelled differently (case, separators) than the
    // stored current path; that is still the current config.
    let is_current = current
        .config_path
        .as_deref()
        .is_some_and(|active| same_path(Path::new(active), &validated));
    if !is_current && !state.is_config_approved(&validated) && !state.is_config_known(&validated) {
        return Err(AppError::new(
            "PATH_NOT_APPROVED",
            "choose the project config with the native file dialog",
        )
        .with_details(serde_json::json!({
            "path": validated.display().to_string(),
        })));
    }
    if !is_current && !validated.is_file() {
        return Err(AppError::new(
            "CONFIG_NOT_FOUND",
            format!("config file not found: {}", validated.display()),
        )
        .with_details(serde_json::json!({
            "path": validated.display().to_string(),
        })));
    }
    Ok(())
}

/// Run blocking filesystem work off the UI thread with a deadline. A blocking
/// task cannot be aborted, so a timed-out call keeps its thread until the
/// kernel call returns; the UI is free either way.
async fn spawn_blocking_with_timeout<T, F>(
    label: &'static str,
    timeout: Duration,
    work: F,
) -> AppResult<T>
where
    F: FnOnce() -> AppResult<T> + Send + 'static,
    T: Send + 'static,
{
    match tokio::time::timeout(timeout, tokio::task::spawn_blocking(work)).await {
        Ok(Ok(result)) => result,
        Ok(Err(err)) => Err(AppError::new(
            "INTERNAL",
            format!("{label} task failed: {err}"),
        )),
        Err(_) => Err(AppError::new(
            "PATH_TIMEOUT",
            format!("{label} did not finish within {}s", timeout.as_secs()),
        )),
    }
}

/// A TOML parser error can quote the offending line. Redact it before it is
/// serialized into `ConfigReadResult`/`ConfigValidateResult`.
fn redacted_syntax_error(error: &AppError) -> String {
    crate::error::redact_secrets(&error.message())
}

/// A draft must not persist a `storage.data_dir` that names a network share or
/// a device: every later run would resolve it and authenticate to the share.
fn ensure_local_data_dir(document: &DocumentMut, config_path: &Path) -> AppResult<()> {
    config::data_dir_from_document(document, config_path)?;
    Ok(())
}

/// Resolve the config a command may touch. The webview may only name the
/// project config chosen in Settings; `settings_set` is the only way to change
/// the active project. A requested path that differs from the active one is
/// rejected instead of being validated or executed.
fn resolve_active_config_opt(
    state: &AppState,
    requested: Option<String>,
) -> AppResult<Option<PathBuf>> {
    let requested = requested.filter(|value| !value.trim().is_empty());
    let settings = state.settings.get();
    let active = settings
        .config_path
        .as_deref()
        .map(paths::validate_config_path)
        .transpose()?;
    match (requested, active) {
        (Some(requested), Some(active)) => {
            let requested = paths::validate_config_path(&requested)?;
            if same_path(&requested, &active) {
                Ok(Some(active))
            } else {
                Err(AppError::new(
                    "PATH_NOT_ALLOWED",
                    "the requested config is not the active project config selected in Settings",
                )
                .with_details(serde_json::json!({
                    "requested": requested.display().to_string(),
                    "active": active.display().to_string(),
                })))
            }
        }
        (Some(requested), None) => {
            let requested = paths::validate_config_path(&requested)?;
            Err(AppError::new(
                "PATH_NOT_ALLOWED",
                "no active project config is selected in Settings; choose one with settings_set",
            )
            .with_details(serde_json::json!({
                "requested": requested.display().to_string(),
                "active": serde_json::Value::Null,
            })))
        }
        (None, active) => Ok(active),
    }
}

fn resolve_active_config(state: &AppState, requested: Option<String>) -> AppResult<PathBuf> {
    resolve_active_config_opt(state, requested)?.ok_or_else(|| {
        AppError::new(
            "CONFIG_PATH_REQUIRED",
            "choose a project config in Settings first",
        )
    })
}

/// `report_weekly` always writes into `<export_dir>/reports` unless the webview
/// supplies another absolute directory that resolves inside the export root.
/// The directory is created before the engine runs.
fn report_output_dir(state: &AppState, requested: Option<String>) -> AppResult<PathBuf> {
    let export_dir = state.paths.export_dir.clone();
    let requested = requested.filter(|value| !value.trim().is_empty());
    let directory = match requested {
        Some(raw) => {
            let requested = paths::validate_absolute_path(&raw, "report output")?;
            paths::ensure_dir_within_roots(&requested, std::slice::from_ref(&export_dir))?
        }
        None => export_dir.join("reports"),
    };
    fs::create_dir_all(&directory).map_err(|err| {
        AppError::new(
            "EXPORT_DIR",
            format!("cannot create report output {}: {err}", directory.display()),
        )
    })?;
    Ok(directory)
}

fn allowed_roots(app_paths: &paths::AppPaths, settings: &Settings) -> Vec<PathBuf> {
    let mut roots = vec![
        app_paths.config_dir.clone(),
        app_paths.data_dir.clone(),
        app_paths.log_dir.clone(),
        app_paths.export_dir.clone(),
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
                if let Ok(Some(data_dir)) = config::data_dir_from_document(&document, &config_path)
                {
                    if data_dir.parent().is_some() {
                        roots.push(data_dir);
                    }
                }
            }
        }
    }
    // A workspace config must not add a network share or a device namespace to
    // the allow-list: canonicalizing it performs an outbound SMB authentication
    // and can hang for the SMB timeout.
    roots.retain(|root| !paths::is_unsafe_share_reference(&root.to_string_lossy()));
    roots
}

/// `storage.data_dir` as it may be reported to the webview: absent, unreadable
/// and network/device values all become `None`.
fn safe_data_dir(config_path: &Path) -> Option<PathBuf> {
    let raw = config::read_raw(config_path).ok()?;
    let document = raw.parse::<DocumentMut>().ok()?;
    let data_dir = config::data_dir_from_document(&document, config_path)
        .ok()
        .flatten()?;
    (!paths::is_unsafe_share_reference(&data_dir.to_string_lossy())).then_some(data_dir)
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

/// A `{ok:false}` CLI envelope is a rejection, not a ready configuration.
/// Surface the engine's own code/message so Settings can render it immediately.
fn envelope_error(envelope: &serde_json::Value) -> Option<ErrorInfo> {
    if envelope.get("ok").and_then(serde_json::Value::as_bool) != Some(false) {
        return None;
    }
    let error = envelope.get("error");
    let code = error
        .and_then(|value| value.get("code"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("ENGINE_ERROR");
    let message = error
        .and_then(|value| value.get("message"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("the engine rejected the configuration");
    Some(ErrorInfo {
        code: code.to_string(),
        message: message.to_string(),
        details: error.cloned(),
    })
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

    fn app_state(dir: &Path, active: Option<&Path>) -> AppState {
        let paths = paths::AppPaths {
            config_dir: dir.join("app-config"),
            data_dir: dir.join("app-data"),
            log_dir: dir.join("app-logs"),
            export_dir: dir.join("app-data").join("exports"),
        };
        for path in [
            &paths.config_dir,
            &paths.data_dir,
            &paths.log_dir,
            &paths.export_dir,
        ] {
            fs::create_dir_all(path).unwrap();
        }
        let settings =
            SettingsStore::load(paths.config_dir.join(crate::settings::SETTINGS_FILE)).unwrap();
        let mut current = settings.get();
        current.config_path = active.map(|path| path.display().to_string());
        settings.set(current).unwrap();
        let state = AppState::new(paths, settings).unwrap();
        if let Some(active) = active {
            state.approve_config(active).unwrap();
        }
        state
    }

    #[test]
    fn requested_config_must_be_the_active_config() {
        let dir = tempfile::tempdir().unwrap();
        let active = dir.path().join("seo.toml");
        let other = dir.path().join("other.toml");
        fs::write(&active, "version = 1\n").unwrap();
        fs::write(&other, "version = 1\n").unwrap();
        let state = app_state(dir.path(), Some(&active));

        assert_eq!(resolve_active_config(&state, None).unwrap(), active);
        assert_eq!(
            resolve_active_config(&state, Some(active.display().to_string())).unwrap(),
            active
        );

        let error = resolve_active_config(&state, Some(other.display().to_string())).unwrap_err();
        assert_eq!(error.code(), "PATH_NOT_ALLOWED");
        assert_eq!(
            error.details().unwrap()["requested"],
            other.display().to_string()
        );
    }

    #[test]
    fn no_active_config_is_required_or_forbidden() {
        let dir = tempfile::tempdir().unwrap();
        let requested = dir.path().join("seo.toml");
        fs::write(&requested, "version = 1\n").unwrap();
        let state = app_state(dir.path(), None);

        assert!(resolve_active_config_opt(&state, None).unwrap().is_none());
        assert_eq!(
            resolve_active_config(&state, None).unwrap_err().code(),
            "CONFIG_PATH_REQUIRED"
        );
        assert_eq!(
            resolve_active_config(&state, Some(requested.display().to_string()))
                .unwrap_err()
                .code(),
            "PATH_NOT_ALLOWED"
        );
    }

    #[test]
    fn report_output_defaults_to_the_export_directory() {
        let dir = tempfile::tempdir().unwrap();
        let state = app_state(dir.path(), None);

        let out = report_output_dir(&state, None).unwrap();
        assert_eq!(out, state.paths.export_dir.join("reports"));
        assert!(out.is_dir());

        let custom = out.join("custom");
        let resolved = report_output_dir(&state, Some(custom.display().to_string())).unwrap();
        assert!(resolved.is_dir());
        assert!(resolved.ends_with("custom"));

        let outside = dir.path().join("outside");
        fs::create_dir(&outside).unwrap();
        assert_eq!(
            report_output_dir(&state, Some(outside.display().to_string()))
                .unwrap_err()
                .code(),
            "PATH_NOT_ALLOWED"
        );

        let file = state.paths.export_dir.join("report.html");
        fs::write(&file, "x").unwrap();
        assert_eq!(
            report_output_dir(&state, Some(file.display().to_string()))
                .unwrap_err()
                .code(),
            "INVALID_PATH"
        );
    }

    #[test]
    fn logs_analyze_reads_only_an_approved_or_app_owned_file() {
        let dir = tempfile::tempdir().unwrap();
        let state = app_state(dir.path(), None);
        let outside = dir.path().join("outside.log");
        fs::write(&outside, "{}\n").unwrap();

        // An arbitrary webview path is not enough, even when it exists.
        assert_eq!(
            state
                .ensure_log_file_allowed(&outside.display().to_string())
                .unwrap_err()
                .code(),
            "PATH_NOT_APPROVED"
        );

        // A file the user picked in the native dialog is recorded and accepted.
        let approved = state.approve_log_file(&outside).unwrap();
        assert_eq!(approved, outside);
        assert!(state.is_log_file_approved(&outside));
        assert_eq!(
            state
                .ensure_log_file_allowed(&outside.display().to_string())
                .unwrap(),
            outside
        );

        // The app's own data and export directories need no dialog.
        for root in [&state.paths.data_dir, &state.paths.export_dir] {
            let file = root.join("access.log");
            fs::write(&file, "{}\n").unwrap();
            assert_eq!(
                state
                    .ensure_log_file_allowed(&file.display().to_string())
                    .unwrap(),
                file
            );
        }

        // Shape checks still apply after approval.
        let nested = dir.path().join("nested");
        fs::create_dir(&nested).unwrap();
        for path in [
            nested.display().to_string(),
            dir.path().join("missing.log").display().to_string(),
            dir.path().join("*.log").display().to_string(),
            r"\\server\share\access.log".to_string(),
            r"\\.\PhysicalDrive0".to_string(),
        ] {
            assert_eq!(
                state.ensure_log_file_allowed(&path).unwrap_err().code(),
                "INVALID_PATH",
                "{path:?}"
            );
        }
    }

    #[test]
    fn backup_output_needs_the_export_root_or_a_picked_folder() {
        let dir = tempfile::tempdir().unwrap();
        let state = app_state(dir.path(), None);
        let outside = dir.path().join("outside-backups");
        fs::create_dir(&outside).unwrap();

        assert_eq!(
            state
                .ensure_backup_out_allowed(&outside.display().to_string())
                .unwrap_err()
                .code(),
            "PATH_NOT_APPROVED"
        );

        // A folder picked in the native directory dialog is accepted.
        state.approve_directory(&outside).unwrap();
        assert_eq!(
            state
                .ensure_backup_out_allowed(&outside.display().to_string())
                .unwrap(),
            outside
        );

        // The export directory and its children are always accepted.
        let child = state.paths.export_dir.join("backups");
        fs::create_dir(&child).unwrap();
        for path in [&state.paths.export_dir, &child] {
            assert_eq!(
                state
                    .ensure_backup_out_allowed(&path.display().to_string())
                    .unwrap(),
                path.clone()
            );
        }

        // A file or a missing directory is rejected before approval matters.
        let file = state.paths.export_dir.join("archive.zip");
        fs::write(&file, "x").unwrap();
        assert_eq!(
            state
                .ensure_backup_out_allowed(&file.display().to_string())
                .unwrap_err()
                .code(),
            "INVALID_PATH"
        );
        assert_eq!(
            state
                .ensure_backup_out_allowed(
                    &state.paths.export_dir.join("missing").display().to_string()
                )
                .unwrap_err()
                .code(),
            "INVALID_PATH"
        );
    }

    #[test]
    fn backup_restore_reads_only_a_dialog_picked_archive() {
        let dir = tempfile::tempdir().unwrap();
        let state = app_state(dir.path(), None);
        let archive = dir.path().join("lv24-seo-backup.zip");
        fs::write(&archive, "PK\u{3}\u{4}").unwrap();

        // An arbitrary webview path is not enough, even when it exists.
        assert_eq!(
            state
                .ensure_backup_archive_allowed(&archive.display().to_string())
                .unwrap_err()
                .code(),
            "PATH_NOT_APPROVED"
        );

        // A file the user picked in the native dialog is recorded and accepted.
        let approved = state.approve_backup_archive(&archive).unwrap();
        assert_eq!(approved, archive);
        assert_eq!(
            state
                .ensure_backup_archive_allowed(&archive.display().to_string())
                .unwrap(),
            archive
        );

        // Shape checks still apply after approval.
        let directory = dir.path().join("folder.zip");
        fs::create_dir(&directory).unwrap();
        for path in [
            directory.display().to_string(),
            dir.path().join("missing.zip").display().to_string(),
            dir.path().join("backup.tar").display().to_string(),
            dir.path().join("*.zip").display().to_string(),
            r"\\server\share\backup.zip".to_string(),
        ] {
            assert_eq!(
                state
                    .ensure_backup_archive_allowed(&path)
                    .unwrap_err()
                    .code(),
                "INVALID_PATH",
                "{path:?}"
            );
        }
    }

    #[test]
    fn portfolio_root_needs_a_folder_picked_in_the_dialog() {
        let dir = tempfile::tempdir().unwrap();
        let state = app_state(dir.path(), None);
        let root = dir.path().join("projects");
        fs::create_dir(&root).unwrap();

        assert_eq!(
            state
                .ensure_portfolio_root_allowed(&root.display().to_string())
                .unwrap_err()
                .code(),
            "PATH_NOT_APPROVED"
        );

        state.approve_directory(&root).unwrap();
        assert_eq!(
            state
                .ensure_portfolio_root_allowed(&root.display().to_string())
                .unwrap(),
            root
        );

        // The app's own export directory is not a portfolio root just because
        // the shell owns it: the user still has to pick a folder.
        assert_eq!(
            state
                .ensure_portfolio_root_allowed(&state.paths.export_dir.display().to_string())
                .unwrap_err()
                .code(),
            "PATH_NOT_APPROVED"
        );

        let file = dir.path().join("seo.toml");
        fs::write(&file, "version = 1\n").unwrap();
        for path in [
            file.display().to_string(),
            dir.path().join("missing").display().to_string(),
            r"\\server\share\projects".to_string(),
        ] {
            assert_eq!(
                state
                    .ensure_portfolio_root_allowed(&path)
                    .unwrap_err()
                    .code(),
                "INVALID_PATH",
                "{path:?}"
            );
        }
    }

    #[test]
    fn only_a_dialog_picked_config_is_approved() {
        let dir = tempfile::tempdir().unwrap();
        let active = dir.path().join("seo.toml");
        let other = dir.path().join("other.toml");
        fs::write(&active, "version = 1\n").unwrap();
        fs::write(&other, "version = 1\n").unwrap();
        let state = app_state(dir.path(), Some(&active));

        // The already-active config stays usable without a new dialog.
        assert!(state.is_config_approved(&active));
        // Any other .toml on disk is not a valid target for settings_set.
        assert!(!state.is_config_approved(&other));

        let approved = state.approve_config(&other).unwrap();
        assert_eq!(approved, other);
        assert!(state.is_config_approved(&other));
        // An 8.3 alias of the same file compares equal to the canonical entry.
        assert!(state.is_config_approved(&dir.path().join(".").join("other.toml")));

        // Only a .toml with an existing parent can be approved.
        assert_eq!(
            state
                .approve_config(&dir.path().join("notes.txt"))
                .unwrap_err()
                .code(),
            "INVALID_PATH"
        );
        assert!(!state.is_config_approved(&dir.path().join("missing").join("seo.toml")));
    }

    #[test]
    fn network_shares_are_never_an_allowed_root() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("seo.toml");
        fs::write(
            &config,
            "[storage]\ndata_dir = \"\\\\\\\\attacker\\\\share\\\\data\"\n",
        )
        .unwrap();
        let state = app_state(dir.path(), Some(&config));

        let roots = allowed_roots(&state.paths, &state.settings.get());
        assert!(roots
            .iter()
            .all(|root| { !paths::is_unsafe_share_reference(&root.to_string_lossy()) }));
        assert!(roots.contains(&state.paths.config_dir));
        // The share is not surfaced to the webview either.
        assert!(safe_data_dir(&config).is_none());
    }

    #[test]
    fn the_update_gate_serializes_and_cancels() {
        let gate = UpdateGate::default();
        assert!(gate.begin().is_ok());
        // A second concurrent install is refused, not queued.
        assert_eq!(gate.begin().unwrap_err().code(), "UPDATE_IN_PROGRESS");
        assert!(gate.cancel());
        // Once cancelled the installer must not start.
        assert!(!gate.start_install());
        gate.finish(false);
        assert!(!gate.is_cancelled());
        // A cancelled download can be retried.
        assert!(gate.begin().is_ok());
        assert!(gate.start_install());
        // After the installer started, the click cannot cancel anything.
        assert!(!gate.cancel());
        gate.finish(true);
        assert!(!gate.cancel());
    }

    #[test]
    fn a_toml_syntax_error_never_quotes_a_credential() {
        let raw = "token = \"sk-live-123\"\n[storage\n";
        let error = config::parse_toml(raw).unwrap_err();
        let redacted = redacted_syntax_error(&error);
        assert!(!redacted.contains("sk-live-123"), "{redacted}");
        assert_eq!(error.code(), "CONFIG_TOML_INVALID");
    }

    #[test]
    fn a_session_write_secret_is_random_and_hex_encoded() {
        let first = generate_write_secret().unwrap();
        assert_eq!(first.len(), 64);
        assert!(first
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase()));
        let second = generate_write_secret().unwrap();
        assert_ne!(first, second);

        let dir = tempfile::tempdir().unwrap();
        let state = app_state(dir.path(), None);
        assert_eq!(state.write_secret().len(), 64);
        assert!(!state.write_secret().is_empty());
    }

    #[test]
    fn bing_sitescan_url_is_hard_coded_and_percent_encodes_the_site() {
        assert_eq!(
            bing_sitescan_url("https://example.com/").unwrap(),
            "https://www.bing.com/webmasters/sitescan?siteUrl=https%3A%2F%2Fexample.com%2F"
        );
        assert_eq!(
            bing_sitescan_url("https://example.com/a?x=1&y=2#top").unwrap(),
            "https://www.bing.com/webmasters/sitescan?siteUrl=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1%26y%3D2%23top"
        );
    }

    #[test]
    fn bing_sitescan_rejects_non_https_and_malformed_site_urls() {
        for site in [
            "",
            "http://example.com/",
            "ftp://example.com/",
            "javascript:alert(1)",
            "example.com",
            "https://",
            "https:///path",
            "https://user@example.com/",
            "https://:443/",
            "https://example.com/a b",
        ] {
            assert_eq!(
                bing_sitescan_url(site).unwrap_err().code(),
                "INVALID_ARGUMENT",
                "{site:?}"
            );
        }
    }

    #[test]
    fn bing_sitescan_destination_allowlist_rejects_other_hosts_paths_and_params() {
        assert!(ensure_bing_sitescan_destination(
            "https://www.bing.com/webmasters/sitescan?siteUrl=https%3A%2F%2Fexample.com%2F"
        )
        .is_ok());
        for url in [
            "https://evil.test/webmasters/sitescan?siteUrl=x",
            "http://www.bing.com/webmasters/sitescan?siteUrl=x",
            "https://www.bing.com/webmasters/other?siteUrl=x",
            "https://www.bing.com/webmasters/sitescan?siteUrl=x&next=https://evil.test",
            "https://www.bing.com/webmasters/sitescan?siteUrl=x#fragment",
            "https://www.bing.com/webmasters/sitescan?siteUrl=",
            "https://www.bing.com/webmasters/sitescan?siteUrl=x?y",
            "https://www.bing.com.evil.test/webmasters/sitescan?siteUrl=x",
        ] {
            assert_eq!(
                ensure_bing_sitescan_destination(url).unwrap_err().code(),
                "INVALID_ARGUMENT",
                "{url}"
            );
        }
    }

    #[test]
    fn oauth_open_url_only_accepts_the_yandex_authorize_page() {
        let allowed = "https://oauth.yandex.ru/authorize?response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Foauth.yandex.ru%2Fverification_code&state=xyz";
        assert_eq!(validate_oauth_authorize_url(allowed).unwrap(), allowed);
        // Surrounding whitespace is trimmed, not passed to the opener.
        assert_eq!(
            validate_oauth_authorize_url(&format!("  {allowed}  ")).unwrap(),
            allowed
        );
        for url in [
            "",
            "http://oauth.yandex.ru/authorize?response_type=code",
            "ftp://oauth.yandex.ru/authorize?x=1",
            "javascript:alert(1)",
            "https://oauth.yandex.ru/",
            "https://oauth.yandex.ru/authorize",
            "https://oauth.yandex.ru/authorize?",
            "https://oauth.yandex.ru/authorize?x=1#fragment",
            "https://oauth.yandex.ru/authorize?x=1\\y",
            "https://oauth.yandex.ru.evil.test/authorize?x=1",
            "https://user@oauth.yandex.ru/authorize?x=1",
            "https://oauth.yandex.ru:443/authorize?x=1",
            "https://oauth.yandex.ru/other?x=1",
            "https://oauth.yandex.ru/authorize?x=1 y",
        ] {
            assert_eq!(
                validate_oauth_authorize_url(url).unwrap_err().code(),
                "INVALID_ARGUMENT",
                "{url:?}"
            );
        }
    }

    #[test]
    fn the_opener_receives_a_path_without_the_windows_verbatim_prefix() {
        let verbatim = if cfg!(windows) {
            PathBuf::from(r"\\?\C:\Users\me\exports\report.html")
        } else {
            PathBuf::from("/home/me/exports/report.html")
        };
        let opened = opener_path(&verbatim);
        #[cfg(windows)]
        {
            assert_eq!(opened, PathBuf::from(r"C:\Users\me\exports\report.html"));
            // A UNC path keeps its verbatim prefix; it is never allow-listed.
            let unc = PathBuf::from(r"\\?\UNC\server\share\report.html");
            assert_eq!(opener_path(&unc), unc);
        }
        #[cfg(not(windows))]
        assert_eq!(opened, verbatim);
    }

    #[test]
    fn settings_can_only_activate_an_approved_config() {
        let dir = tempfile::tempdir().unwrap();
        let active = dir.path().join("seo.toml");
        let other = dir.path().join("other.toml");
        fs::write(&active, "version = 1\n").unwrap();
        fs::write(&other, "version = 1\n").unwrap();
        let state = app_state(dir.path(), Some(&active));
        let current = state.settings.get();

        let mut updated = current.clone();
        updated.config_path = Some(other.display().to_string());
        let error = ensure_config_path_allowed(&state, &current, &updated).unwrap_err();
        assert_eq!(error.code(), "PATH_NOT_APPROVED");
        assert_eq!(
            error.details().unwrap()["path"],
            other.display().to_string()
        );

        // After the native dialog approved the file, the same patch is allowed.
        state.approve_config(&other).unwrap();
        assert!(ensure_config_path_allowed(&state, &current, &updated).is_ok());

        // An unchanged selection and an explicit clear never need a dialog.
        assert!(ensure_config_path_allowed(&state, &current, &current).is_ok());
        let cleared = Settings {
            config_path: None,
            ..current.clone()
        };
        assert!(ensure_config_path_allowed(&state, &current, &cleared).is_ok());

        // A path that is not a valid config is rejected before the approval
        // check, with the shell's stable INVALID_PATH code.
        let mut invalid = current.clone();
        invalid.config_path = Some(dir.path().join("notes.txt").display().to_string());
        assert_eq!(
            ensure_config_path_allowed(&state, &current, &invalid)
                .unwrap_err()
                .code(),
            "INVALID_PATH"
        );
    }

    #[test]
    fn engine_version_comparison_is_numeric() {
        assert_eq!(MIN_ENGINE_VERSION, "0.14.0");
        assert!(version_at_least(MIN_ENGINE_VERSION, MIN_ENGINE_VERSION));
        assert!(version_at_least("0.14.1", MIN_ENGINE_VERSION));
        assert!(!version_at_least("0.13.1", MIN_ENGINE_VERSION));
        assert!(!version_at_least("0.13.0", MIN_ENGINE_VERSION));
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
    fn rejected_envelope_becomes_an_engine_error() {
        let envelope = serde_json::json!({
            "ok": false,
            "error": {
                "code": "CONFIG_INVALID",
                "message": "project.base_url: must be an absolute URL",
                "retryable": false
            },
            "meta": {},
            "warnings": []
        });
        let error = envelope_error(&envelope).expect("rejection must be surfaced");
        assert_eq!(error.code, "CONFIG_INVALID");
        assert_eq!(error.message, "project.base_url: must be an absolute URL");
        assert_eq!(error.details.unwrap()["code"], "CONFIG_INVALID");
    }

    #[test]
    fn accepted_or_malformed_envelopes_have_no_engine_error() {
        assert!(envelope_error(&serde_json::json!({
            "ok": true,
            "data": {},
            "meta": {},
            "warnings": []
        }))
        .is_none());
        assert!(envelope_error(&serde_json::json!({"data": {}})).is_none());

        let fallback = envelope_error(&serde_json::json!({"ok": false})).unwrap();
        assert_eq!(fallback.code, "ENGINE_ERROR");
        assert!(fallback.message.contains("rejected"));
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

    #[test]
    fn init_requires_a_directory_picked_in_the_native_dialog() {
        let dir = tempfile::tempdir().unwrap();
        let picked = dir.path().join("picked");
        let other = dir.path().join("other");
        fs::create_dir(&picked).unwrap();
        fs::create_dir(&other).unwrap();
        let state = app_state(dir.path(), None);

        // Nothing is approved before the dialog runs.
        assert_eq!(
            state
                .ensure_init_parent_approved(&picked.join("seo.toml"))
                .unwrap_err()
                .code(),
            "PATH_NOT_APPROVED"
        );

        let approved = state.approve_directory(&picked).unwrap();
        assert_eq!(approved, picked);
        assert!(state
            .ensure_init_parent_approved(&picked.join("seo.toml"))
            .is_ok());
        // A sibling folder is still rejected.
        assert_eq!(
            state
                .ensure_init_parent_approved(&other.join("seo.toml"))
                .unwrap_err()
                .code(),
            "PATH_NOT_APPROVED"
        );
        // A subdirectory of the approved folder is not the approved folder.
        fs::create_dir(picked.join("nested")).unwrap();
        assert_eq!(
            state
                .ensure_init_parent_approved(&picked.join("nested").join("seo.toml"))
                .unwrap_err()
                .code(),
            "PATH_NOT_APPROVED"
        );
    }

    #[test]
    fn init_is_allowed_next_to_the_active_config() {
        let dir = tempfile::tempdir().unwrap();
        let active = dir.path().join("seo.toml");
        fs::write(&active, "version = 1\n").unwrap();
        let state = app_state(dir.path(), Some(&active));

        // No folder dialog is needed for a second config in the open project.
        assert!(state
            .ensure_init_parent_approved(&dir.path().join("second.toml"))
            .is_ok());
        let nested = dir.path().join("nested");
        fs::create_dir(&nested).unwrap();
        assert_eq!(
            state
                .ensure_init_parent_approved(&nested.join("seo.toml"))
                .unwrap_err()
                .code(),
            "PATH_NOT_APPROVED"
        );
    }

    #[test]
    fn approve_directory_rejects_files_and_network_shares() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("notes.txt");
        fs::write(&file, "x").unwrap();
        let state = app_state(dir.path(), None);

        assert_eq!(
            state.approve_directory(&file).unwrap_err().code(),
            "INVALID_PATH"
        );
        for raw in [
            r"\\server\share",
            r"\\.\PhysicalDrive0",
            r"\\?\C:\Windows",
            "relative/folder",
        ] {
            assert_eq!(
                state.approve_directory(Path::new(raw)).unwrap_err().code(),
                "INVALID_PATH",
                "{raw:?}"
            );
        }
        // The returned path is usable as a config parent, not a verbatim one.
        let approved = state.approve_directory(dir.path()).unwrap();
        assert!(!approved.to_string_lossy().starts_with(r"\\?\"));
        assert!(state.is_directory_approved(dir.path()));
    }

    #[test]
    fn init_created_config_can_be_activated_without_another_dialog() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("seo.toml");
        fs::write(&config, "version = 1\n").unwrap();
        let state = app_state(dir.path(), None);

        // `cli_run(init)` records the created file through this call.
        state.approve_config(&config).unwrap();
        assert!(state
            .settings
            .get()
            .known_configs
            .iter()
            .any(|known| same_path(Path::new(known), &config)));

        let current = state.settings.get();
        let updated = Settings {
            config_path: Some(config.display().to_string()),
            ..current.clone()
        };
        assert!(ensure_config_path_allowed(&state, &current, &updated).is_ok());
    }

    #[test]
    fn a_known_config_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("seo.toml");
        fs::write(&config, "version = 1\n").unwrap();
        {
            let state = app_state(dir.path(), None);
            state.approve_config(&config).unwrap();
        }

        // A new AppState over the same settings file has no in-process
        // approvals, but the persisted known list still allows the switch.
        let restarted = app_state(dir.path(), None);
        assert!(!restarted.is_config_approved(&config));
        let current = restarted.settings.get();
        let updated = Settings {
            config_path: Some(config.display().to_string()),
            ..current.clone()
        };
        assert!(ensure_config_path_allowed(&restarted, &current, &updated).is_ok());
    }

    #[test]
    fn an_arbitrary_config_is_still_unapproved_after_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let known = dir.path().join("known.toml");
        let other = dir.path().join("other.toml");
        fs::write(&known, "version = 1\n").unwrap();
        fs::write(&other, "version = 1\n").unwrap();
        {
            let state = app_state(dir.path(), None);
            state.approve_config(&known).unwrap();
        }

        let restarted = app_state(dir.path(), None);
        let current = restarted.settings.get();
        let updated = Settings {
            config_path: Some(other.display().to_string()),
            ..current.clone()
        };
        let error = ensure_config_path_allowed(&restarted, &current, &updated).unwrap_err();
        assert_eq!(error.code(), "PATH_NOT_APPROVED");
    }

    #[test]
    fn a_deleted_known_config_is_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("seo.toml");
        fs::write(&config, "version = 1\n").unwrap();
        {
            let state = app_state(dir.path(), None);
            state.approve_config(&config).unwrap();
        }
        fs::remove_file(&config).unwrap();

        // The entry is persisted, so the answer is "gone", not "never picked".
        let restarted = app_state(dir.path(), None);
        let current = restarted.settings.get();
        let updated = Settings {
            config_path: Some(config.display().to_string()),
            ..current.clone()
        };
        let error = ensure_config_path_allowed(&restarted, &current, &updated).unwrap_err();
        assert_eq!(error.code(), "CONFIG_NOT_FOUND");
    }
}
