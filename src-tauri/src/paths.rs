use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

pub const APP_IDENTIFIER: &str = "by.lv24.seo.desktop";
pub const ENGINE_ENV: &str = "LV24_SEO_BIN";
/// The PATH fallback is opt-in. Without it a stray `lv24-seo` on PATH must not
/// redirect the shell (and the webview) to an arbitrary executable.
pub const ALLOW_PATH_ENGINE_ENV: &str = "LV24_SEO_ALLOW_PATH_ENGINE";
pub const ENGINE_DIR: &str = "engine";
pub const ENGINE_FOLDER: &str = "lv24-seo";

/// Directories owned by the desktop shell.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
    pub export_dir: PathBuf,
}

impl AppPaths {
    pub fn resolve(app: &AppHandle) -> AppResult<Self> {
        let resolver = app.path();
        let config_dir = resolver.app_config_dir().map_err(|err| {
            AppError::new("PATHS", format!("cannot resolve app config dir: {err}"))
        })?;
        let data_dir = resolver
            .app_data_dir()
            .map_err(|err| AppError::new("PATHS", format!("cannot resolve app data dir: {err}")))?;
        let log_dir = resolver
            .app_log_dir()
            .map_err(|err| AppError::new("PATHS", format!("cannot resolve app log dir: {err}")))?;
        let export_dir = data_dir.join("exports");
        for dir in [&config_dir, &data_dir, &log_dir, &export_dir] {
            fs::create_dir_all(dir).map_err(|err| {
                AppError::new("PATHS", format!("cannot create {}: {err}", dir.display()))
            })?;
        }
        Ok(Self {
            config_dir,
            data_dir,
            log_dir,
            export_dir,
        })
    }
}

/// The engine executable chosen for this run.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineLocation {
    pub path: PathBuf,
    pub source: String,
}

impl EngineLocation {
    pub fn display_path(&self) -> String {
        self.path.display().to_string()
    }
}

pub fn engine_exe_name() -> &'static str {
    if cfg!(windows) {
        "lv24-seo.exe"
    } else {
        "lv24-seo"
    }
}

/// Resolve the CLI without invoking a shell.
///
/// Order: `LV24_SEO_BIN` (absolute only), bundled resource
/// `engine/lv24-seo/lv24-seo[.exe]`, flat resource `lv24-seo/lv24-seo[.exe]`,
/// a Linux AppImage `usr/lib/<app>/engine/...` tree, sibling
/// `lv24-seo/lv24-seo[.exe]`, then PATH only when `LV24_SEO_ALLOW_PATH_ENGINE=1`.
/// Nothing is downloaded automatically.
pub fn locate_engine(app: &AppHandle) -> AppResult<EngineLocation> {
    let exe_name = engine_exe_name();

    if let Some(raw) = env_nonempty(ENGINE_ENV) {
        let raw_path = PathBuf::from(&raw);
        if !raw_path.is_absolute() {
            return Err(AppError::new(
                "INVALID_PATH",
                format!("{ENGINE_ENV} must be an absolute path, got {raw:?}"),
            ));
        }
        let path = normalize_absolute(&raw_path)?;
        if !path.is_file() {
            return Err(AppError::new(
                "ENGINE_NOT_FOUND",
                format!(
                    "{ENGINE_ENV} points at {}, but it is not a file",
                    path.display()
                ),
            )
            .with_details(
                serde_json::json!({ "path": path.display().to_string(), "source": "env" }),
            ));
        }
        if !is_executable(&path) {
            return Err(AppError::new(
                "ENGINE_NOT_EXECUTABLE",
                format!(
                    "{ENGINE_ENV} points at {}, but it is not executable",
                    path.display()
                ),
            ));
        }
        return Ok(EngineLocation {
            path,
            source: "env".to_string(),
        });
    }

    let mut candidates: Vec<(PathBuf, &'static str)> = Vec::new();
    match app.path().resource_dir() {
        Ok(resource_dir) => {
            candidates.push((
                resource_dir
                    .join(ENGINE_DIR)
                    .join(ENGINE_FOLDER)
                    .join(exe_name),
                "bundled",
            ));
            candidates.push((
                resource_dir.join(ENGINE_FOLDER).join(exe_name),
                "bundled-flat",
            ));
        }
        Err(err) => {
            // A missing resource dir is not fatal (a portable/sibling layout
            // still works), but the reason must not disappear: it explains why
            // the bundled candidates are absent from the error details.
            log::warn!("cannot resolve the app resource dir: {err}");
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(appdir) = env::var_os("APPDIR").map(PathBuf::from) {
            if appdir.is_absolute() {
                for path in appdir_candidates(&appdir, exe_name) {
                    candidates.push((path, "appimage"));
                }
            }
        }
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push((parent.join(ENGINE_FOLDER).join(exe_name), "sibling"));
        }
    }

    let mut blocked: Vec<(PathBuf, &'static str)> = Vec::new();
    if let Some(location) = pick_engine(&candidates, &mut blocked) {
        return Ok(location);
    }

    let path_fallback = flag_enabled(env_nonempty(ALLOW_PATH_ENGINE_ENV).as_deref());
    if path_fallback {
        if let Some(path) = find_on_path(exe_name) {
            return Ok(EngineLocation {
                path,
                source: "PATH".to_string(),
            });
        }
    }

    let mut message = format!(
        "lv24-seo engine not found; set {ENGINE_ENV} to an absolute executable path, bundle \
         {ENGINE_DIR}/{ENGINE_FOLDER}/{exe_name}, install a sibling {ENGINE_FOLDER}/{exe_name}, \
         or set {ALLOW_PATH_ENGINE_ENV}=1 to allow a PATH lookup"
    );
    if let Some((path, _)) = blocked.first() {
        // A portable archive extracted without the executable bit must not look
        // like "no engine at all".
        message.push_str(&format!(
            "; {} exists but is not executable",
            path.display()
        ));
    }
    Err(
        AppError::new("ENGINE_NOT_FOUND", message).with_details(serde_json::json!({
            "candidates": candidates
                .iter()
                .map(|(path, source)| serde_json::json!({
                    "path": path.display().to_string(),
                    "source": source,
                }))
                .collect::<Vec<_>>(),
            "notExecutable": blocked
                .iter()
                .map(|(path, source)| serde_json::json!({
                    "path": path.display().to_string(),
                    "source": source,
                }))
                .collect::<Vec<_>>(),
            "pathFallback": {
                "allowed": path_fallback,
                "env": ALLOW_PATH_ENGINE_ENV,
            },
        })),
    )
}

/// First candidate that exists and is executable. Candidates that exist but
/// lack the executable bit are reported to the caller so the final error can
/// name them instead of pretending nothing was found.
fn pick_engine(
    candidates: &[(PathBuf, &'static str)],
    blocked: &mut Vec<(PathBuf, &'static str)>,
) -> Option<EngineLocation> {
    for (candidate, source) in candidates {
        if !candidate.is_file() {
            continue;
        }
        if is_executable(candidate) {
            return Some(EngineLocation {
                path: candidate.clone(),
                source: (*source).to_string(),
            });
        }
        blocked.push((candidate.clone(), source));
    }
    None
}

fn flag_enabled(value: Option<&str>) -> bool {
    value.map(|value| value == "1").unwrap_or(false)
}

fn env_nonempty(name: &str) -> Option<String> {
    // `var_os` keeps a non-UTF-8 value visible: `var` would report "not set"
    // and silently fall back to the bundled engine.
    env::var_os(name)
        .map(|value| value.to_string_lossy().trim().trim_matches('"').to_string())
        .filter(|value| !value.is_empty())
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let raw = env::var_os("PATH")?;
    for dir in env::split_paths(&raw) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        // Try the entry as-is first: a non-UTF-8 PATH entry must not be
        // corrupted by a lossy string round-trip.
        if let Some(found) = engine_in(&dir, name) {
            return Some(found);
        }
        if let Some(unquoted) = unquote_path(&dir) {
            if let Some(found) = engine_in(&unquoted, name) {
                return Some(found);
            }
        }
    }
    None
}

fn engine_in(dir: &Path, name: &str) -> Option<PathBuf> {
    let candidate = dir.join(name);
    (candidate.is_file() && is_executable(&candidate)).then_some(candidate)
}

/// A PATH entry is sometimes stored as `"C:\Program Files\LV24"`; strip the
/// quotes only when the entry really is valid UTF-8.
fn unquote_path(dir: &Path) -> Option<PathBuf> {
    let raw = dir.to_str()?;
    let trimmed = raw.trim_matches('"');
    (trimmed != raw).then(|| PathBuf::from(trimmed))
}

/// Engine trees inside a mounted Linux AppImage. `resource_dir()` normally
/// points at `<APPDIR>/usr/lib/<product>`, but when the inner binary is started
/// directly (or the product directory name differs) the engine still sits one
/// level below `usr/lib`. Scanning that single level keeps the layout
/// independent of the bundle's product name.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn appdir_candidates(appdir: &Path, exe_name: &str) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let entries = match fs::read_dir(appdir.join("usr").join("lib")) {
        Ok(entries) => entries,
        Err(err) => {
            log::debug!(
                "no AppImage engine directory under {}: {err}",
                appdir.display()
            );
            return found;
        }
    };
    for entry in entries.filter_map(Result::ok) {
        let base = entry.path();
        if !base.is_dir() {
            continue;
        }
        let candidate = base.join(ENGINE_DIR).join(ENGINE_FOLDER).join(exe_name);
        if candidate.is_file() {
            found.push(candidate);
        }
    }
    found.sort();
    found
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("exe"))
            .unwrap_or(false)
}

#[cfg(all(not(unix), not(windows)))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

/// Absolute path with `.` removed and `..` rejected.
pub fn normalize_absolute(path: &Path) -> AppResult<PathBuf> {
    if !path.is_absolute() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("path must be absolute: {}", path.display()),
        ));
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(AppError::new(
                    "INVALID_PATH",
                    format!("path must not contain '..': {}", path.display()),
                ));
            }
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
        }
    }
    if normalized.file_name().is_none() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("path has no file name: {}", path.display()),
        ));
    }
    Ok(normalized)
}

/// Validate an absolute path without requiring it to exist.
pub fn validate_absolute_path(raw: &str, label: &str) -> AppResult<PathBuf> {
    if raw.chars().any(char::is_control) {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("{label} path contains control characters"),
        ));
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("{label} path is empty"),
        ));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("{label} path must be absolute: {trimmed}"),
        ));
    }
    let normalized = normalize_absolute(&path)?;
    let name = normalized
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            AppError::new(
                "INVALID_PATH",
                format!("{label} path has no UTF-8 file name"),
            )
        })?;
    if name.trim().is_empty() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("{label} path has an empty file name"),
        ));
    }
    #[cfg(windows)]
    validate_windows_components(&normalized, label)?;
    Ok(normalized)
}

/// Windows silently strips trailing dots and spaces and maps reserved device
/// names to devices. Checking only the last component would let
/// `C:\CON\seo.toml` or `C:\tmp. \seo.toml` through, so every component is
/// checked before the path is used.
#[cfg(windows)]
fn validate_windows_components(path: &Path, label: &str) -> AppResult<()> {
    for component in path.components() {
        let Component::Normal(raw) = component else {
            continue;
        };
        let name = raw.to_str().ok_or_else(|| {
            AppError::new(
                "INVALID_PATH",
                format!("{label} path has a non-UTF-8 component"),
            )
        })?;
        if name.ends_with(' ') || name.ends_with('.') {
            return Err(AppError::new(
                "INVALID_PATH",
                format!("{label} path has a component ending in a space or dot: {name:?}"),
            ));
        }
        if is_reserved_windows_name(name) {
            return Err(AppError::new(
                "INVALID_PATH",
                format!("{label} path uses a reserved Windows file name: {name}"),
            ));
        }
        if name
            .chars()
            .any(|ch| matches!(ch, ':' | '*' | '?' | '<' | '>' | '|' | '"'))
        {
            return Err(AppError::new(
                "INVALID_PATH",
                format!("{label} path contains characters invalid on Windows: {name}"),
            ));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn is_reserved_windows_name(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$" | "CLOCK$"
    ) {
        return true;
    }
    stem.len() == 4
        && (stem.starts_with("COM") || stem.starts_with("LPT"))
        && stem.as_bytes()[3].is_ascii_digit()
}
/// Windows treats `\\server\share` (UNC), `\\?\C:\...` (verbatim) and
/// `\\.\device` as absolute paths, so a workspace config could point the shell
/// and the engine at a remote share. Resolving such a path performs an
/// outbound SMB authentication (NetNTLM leakage) and can block for the SMB
/// timeout. The check is string-based on purpose: it must catch the raw
/// `storage.data_dir` value before it is joined to the config directory.
pub fn is_unsafe_share_reference(raw: &str) -> bool {
    let trimmed = raw.trim_start();
    let forward = trimmed.replace('\\', "/");
    forward.starts_with("//") || forward.starts_with("/??/")
}

/// Reject a raw path value that names a network share or a device namespace.
pub fn ensure_local_path(raw: &str, label: &str) -> AppResult<()> {
    if is_unsafe_share_reference(raw) {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("{label} must be a local path, got a network or device path: {raw}"),
        )
        .with_details(serde_json::json!({
            "path": raw,
            "reason": "network_or_device_path",
        })));
    }
    Ok(())
}

/// Validate a path to a configuration file. The parent must already exist.
pub fn validate_config_path(raw: &str) -> AppResult<PathBuf> {
    let path = validate_absolute_path(raw, "config")?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if !extension.eq_ignore_ascii_case("toml") {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("config path must end with .toml: {}", path.display()),
        ));
    }
    let parent = path.parent().ok_or_else(|| {
        AppError::new(
            "INVALID_PATH",
            format!("config path has no parent: {}", path.display()),
        )
    })?;
    if !parent.is_dir() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("config parent is not a directory: {}", parent.display()),
        ));
    }
    if path.exists() && path.is_dir() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("config path is a directory: {}", path.display()),
        ));
    }
    Ok(path)
}

/// Validate the destination of `init`: a new `.toml` whose parent exists.
/// `init` only writes local state, so a network share or a device namespace is
/// rejected before the engine could touch it.
pub fn validate_init_config_path(raw: &str) -> AppResult<PathBuf> {
    ensure_local_path(raw, "config")?;
    validate_config_path(raw)
}

/// Validate the `init --data-dir` destination. The directory itself may not
/// exist yet (the engine creates it), but its parent must.
pub fn validate_init_data_dir(raw: &str) -> AppResult<PathBuf> {
    ensure_local_path(raw, "data directory")?;
    let path = validate_absolute_path(raw, "data directory")?;
    let parent = path.parent().ok_or_else(|| {
        AppError::new(
            "INVALID_PATH",
            format!("data directory has no parent: {}", path.display()),
        )
    })?;
    if !parent.is_dir() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!(
                "data directory parent is not a directory: {}",
                parent.display()
            ),
        ));
    }
    if path.exists() && !path.is_dir() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("data directory is a file: {}", path.display()),
        ));
    }
    Ok(path)
}

/// The engine refuses logs larger than this before reading a byte; the shell
/// mirrors the cap so an oversized file fails without spawning the sidecar.
pub const MAX_LOG_FILE_BYTES: u64 = 100 * 1024 * 1024;

/// Validate one user-supplied access log. The contract is deliberately narrow:
/// one absolute local regular file, never a glob, a directory, a network share
/// or a Windows device. Approval (native dialog or export/data roots) is
/// checked by the caller; this function only proves the path is safe to hand to
/// the engine.
pub fn validate_log_file_path(raw: &str, label: &str) -> AppResult<PathBuf> {
    ensure_local_path(raw, label)?;
    if raw.chars().any(|ch| matches!(ch, '*' | '?' | '[')) {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("{label} must name exactly one file, not a glob"),
        ));
    }
    let path = validate_absolute_path(raw, label)?;
    #[cfg(windows)]
    if !matches!(
        path.components().next(),
        Some(std::path::Component::Prefix(_))
    ) {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("{label} must include a drive letter: {}", path.display()),
        ));
    }
    let metadata = fs::metadata(&path).map_err(|err| {
        AppError::new(
            "INVALID_PATH",
            format!("{label} is not accessible: {} ({err})", path.display()),
        )
    })?;
    if metadata.is_dir() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("{label} is a directory: {}", path.display()),
        ));
    }
    if !metadata.is_file() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("{label} is not a regular file: {}", path.display()),
        ));
    }
    if metadata.len() > MAX_LOG_FILE_BYTES {
        return Err(AppError::new(
            "INVALID_PATH",
            format!(
                "{label} is larger than the {MAX_LOG_FILE_BYTES} byte limit: {}",
                path.display()
            ),
        )
        .with_details(serde_json::json!({
            "sizeBytes": metadata.len(),
            "maxBytes": MAX_LOG_FILE_BYTES,
        })));
    }
    Ok(path)
}

/// Validate an existing local directory (the native folder dialog result).
pub fn validate_directory_path(raw: &str, label: &str) -> AppResult<PathBuf> {
    ensure_local_path(raw, label)?;
    let path = validate_absolute_path(raw, label)?;
    if !path.is_dir() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("{label} is not a directory: {}", path.display()),
        ));
    }
    Ok(path)
}

/// Resolve `path` and require it to live under one of `roots`.
pub fn ensure_within_roots(path: &Path, roots: &[PathBuf]) -> AppResult<PathBuf> {
    let canonical = fs::canonicalize(path).map_err(|err| {
        AppError::new(
            "PATH_NOT_FOUND",
            format!("cannot resolve {}: {err}", path.display()),
        )
    })?;
    for canonical_root in canonical_roots(roots) {
        if path_starts_with(&canonical, &canonical_root) {
            return Ok(canonical);
        }
    }
    Err(outside_roots(path, roots))
}

/// Canonical, real-directory roots. A root that cannot be resolved (deleted
/// project folder, unmounted share) or that is not a directory is skipped, but
/// the reason is logged instead of silently shrinking the allow-list.
fn canonical_roots(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut canonical = Vec::with_capacity(roots.len());
    for root in roots {
        match fs::canonicalize(root) {
            Ok(path) => {
                if !path.is_dir() {
                    log::warn!("ignoring non-directory allow-list root {}", root.display());
                } else if path.parent().is_none() {
                    log::warn!(
                        "ignoring filesystem root {} as an allow-list root",
                        root.display()
                    );
                } else {
                    canonical.push(path);
                }
            }
            Err(err) => log::warn!("cannot resolve allow-list root {}: {err}", root.display()),
        }
    }
    canonical
}

fn outside_roots(path: &Path, roots: &[PathBuf]) -> AppError {
    AppError::new(
        "PATH_NOT_ALLOWED",
        format!(
            "{} is outside the approved config/data directories",
            path.display()
        ),
    )
    .with_details(serde_json::json!({
        "path": path.display().to_string(),
        "roots": roots.iter().map(|root| root.display().to_string()).collect::<Vec<_>>(),
    }))
}

fn path_starts_with(path: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let path = path.to_string_lossy().to_lowercase();
        let root = root.to_string_lossy().to_lowercase();
        let root = root.trim_end_matches('\\');
        path == root || path.starts_with(&format!("{root}\\"))
    }
    #[cfg(not(windows))]
    {
        path.starts_with(root)
    }
}

/// Like [`ensure_within_roots`], but for a file that may not exist yet. The
/// parent directory must exist and be under an approved root.
pub fn ensure_write_within_roots(path: &Path, roots: &[PathBuf]) -> AppResult<PathBuf> {
    let parent = path.parent().ok_or_else(|| {
        AppError::new(
            "INVALID_PATH",
            format!("path has no parent: {}", path.display()),
        )
    })?;
    if !parent.is_dir() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("parent is not a directory: {}", parent.display()),
        ));
    }
    if path.exists() && path.is_dir() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("path is a directory: {}", path.display()),
        ));
    }
    let canonical_parent = fs::canonicalize(parent).map_err(|err| {
        AppError::new(
            "PATH_NOT_FOUND",
            format!("cannot resolve {}: {err}", parent.display()),
        )
    })?;
    for canonical_root in canonical_roots(roots) {
        if path_starts_with(&canonical_parent, &canonical_root) {
            let name = path
                .file_name()
                .ok_or_else(|| AppError::new("INVALID_PATH", "path has no file name"))?;
            return Ok(canonical_parent.join(name));
        }
    }
    Err(outside_roots(path, roots))
}

/// Like [`ensure_write_within_roots`], but for a directory that may not exist
/// yet. An existing directory is canonicalized (so a symlink cannot redirect
/// report writes outside the root); a missing one must have an existing parent
/// under an approved root.
pub fn ensure_dir_within_roots(path: &Path, roots: &[PathBuf]) -> AppResult<PathBuf> {
    if path.exists() && !path.is_dir() {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("path is not a directory: {}", path.display()),
        ));
    }
    let canonical = if path.exists() {
        fs::canonicalize(path).map_err(|err| {
            AppError::new(
                "PATH_NOT_FOUND",
                format!("cannot resolve {}: {err}", path.display()),
            )
        })?
    } else {
        let parent = path.parent().ok_or_else(|| {
            AppError::new(
                "INVALID_PATH",
                format!("path has no parent: {}", path.display()),
            )
        })?;
        if !parent.is_dir() {
            return Err(AppError::new(
                "INVALID_PATH",
                format!("parent is not a directory: {}", parent.display()),
            ));
        }
        let canonical_parent = fs::canonicalize(parent).map_err(|err| {
            AppError::new(
                "PATH_NOT_FOUND",
                format!("cannot resolve {}: {err}", parent.display()),
            )
        })?;
        let name = path
            .file_name()
            .ok_or_else(|| AppError::new("INVALID_PATH", "path has no file name"))?;
        canonical_parent.join(name)
    };
    for canonical_root in canonical_roots(roots) {
        if path_starts_with(&canonical, &canonical_root) {
            return Ok(canonical);
        }
    }
    Err(outside_roots(path, roots))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_config_paths_are_rejected() {
        let error = validate_config_path("seo.toml").unwrap_err();
        assert_eq!(error.code(), "INVALID_PATH");
    }

    #[test]
    fn parent_traversal_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("..").join("seo.toml");
        let error = validate_config_path(&path.display().to_string()).unwrap_err();
        assert_eq!(error.code(), "INVALID_PATH");
    }

    #[test]
    fn control_characters_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = format!("{}\n", dir.path().join("seo.toml").display());
        let error = validate_config_path(&path).unwrap_err();
        assert_eq!(error.code(), "INVALID_PATH");
    }

    #[test]
    fn existing_parent_is_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seo.toml");
        let validated = validate_config_path(&path.display().to_string()).unwrap();
        assert_eq!(validated, path);
    }

    #[test]
    fn config_paths_must_be_toml() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seo.cmd");
        let error = validate_config_path(&path.display().to_string()).unwrap_err();
        assert_eq!(error.code(), "INVALID_PATH");
    }

    #[cfg(windows)]
    #[test]
    fn reserved_windows_names_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            "CON.toml",
            "NUL.toml",
            "COM1.toml",
            "LPT9.toml",
            "COM0.toml",
            "conin$.toml",
            "CONOUT$.toml",
            "CLOCK$.toml",
        ] {
            let path = dir.path().join(name);
            let error = validate_config_path(&path.display().to_string()).unwrap_err();
            assert_eq!(error.code(), "INVALID_PATH", "{name}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn reserved_names_and_trailing_dots_in_parent_components_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        for parent in ["CON", "NUL", "aux", "tmp.", "tmp "] {
            let path = dir.path().join(parent).join("seo.toml");
            let error = validate_config_path(&path.display().to_string()).unwrap_err();
            assert_eq!(error.code(), "INVALID_PATH", "{parent:?}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_alternate_data_streams_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seo.toml:evil");
        let error = validate_config_path(&path.display().to_string()).unwrap_err();
        assert_eq!(error.code(), "INVALID_PATH");
    }

    #[test]
    fn missing_parent_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing").join("seo.toml");
        let error = validate_config_path(&path.display().to_string()).unwrap_err();
        assert_eq!(error.code(), "INVALID_PATH");
    }

    #[test]
    fn open_path_allow_list_rejects_outside_files() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let inside = root.path().join("report.html");
        let outside = other.path().join("secret.txt");
        fs::write(&inside, "ok").unwrap();
        fs::write(&outside, "no").unwrap();

        assert!(ensure_within_roots(&inside, &[root.path().to_path_buf()]).is_ok());
        let error = ensure_within_roots(&outside, &[root.path().to_path_buf()]).unwrap_err();
        assert_eq!(error.code(), "PATH_NOT_ALLOWED");
    }

    #[test]
    fn write_allow_list_accepts_new_files_inside_roots() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let inside = root.path().join("exports").join("report.json");
        fs::create_dir(root.path().join("exports")).unwrap();
        let target = ensure_write_within_roots(&inside, &[root.path().to_path_buf()]).unwrap();
        assert!(target.ends_with("report.json"));

        let outside = other.path().join("report.json");
        let error = ensure_write_within_roots(&outside, &[root.path().to_path_buf()]).unwrap_err();
        assert_eq!(error.code(), "PATH_NOT_ALLOWED");
    }

    #[test]
    fn directory_allow_list_handles_existing_and_missing_targets() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let existing = root.path().join("reports");
        fs::create_dir(&existing).unwrap();
        let accepted = ensure_dir_within_roots(&existing, &[root.path().to_path_buf()]).unwrap();
        assert!(accepted.is_dir());

        let missing = root.path().join("reports-2");
        let accepted = ensure_dir_within_roots(&missing, &[root.path().to_path_buf()]).unwrap();
        assert!(accepted.ends_with("reports-2"));
        assert!(!accepted.exists());

        let outside = other.path().join("reports");
        fs::create_dir(&outside).unwrap();
        let error = ensure_dir_within_roots(&outside, &[root.path().to_path_buf()]).unwrap_err();
        assert_eq!(error.code(), "PATH_NOT_ALLOWED");

        let file = root.path().join("report.html");
        fs::write(&file, "x").unwrap();
        let error = ensure_dir_within_roots(&file, &[root.path().to_path_buf()]).unwrap_err();
        assert_eq!(error.code(), "INVALID_PATH");
    }

    #[test]
    fn path_engine_fallback_needs_the_explicit_opt_in() {
        assert!(flag_enabled(Some("1")));
        assert!(!flag_enabled(Some("0")));
        assert!(!flag_enabled(Some("true")));
        assert!(!flag_enabled(Some("")));
        assert!(!flag_enabled(None));
        assert_eq!(ALLOW_PATH_ENGINE_ENV, "LV24_SEO_ALLOW_PATH_ENGINE");
    }

    #[test]
    fn a_sibling_directory_with_the_root_as_a_prefix_is_not_inside() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("data");
        let sibling = parent.path().join("data-evil");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&sibling).unwrap();
        let inside = root.join("report.html");
        let escaped = sibling.join("report.html");
        fs::write(&inside, "ok").unwrap();
        fs::write(&escaped, "no").unwrap();

        assert!(ensure_within_roots(&inside, std::slice::from_ref(&root)).is_ok());
        let error = ensure_within_roots(&escaped, std::slice::from_ref(&root)).unwrap_err();
        assert_eq!(error.code(), "PATH_NOT_ALLOWED");
    }

    #[test]
    fn a_file_cannot_be_an_allow_list_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("data");
        fs::create_dir(&root).unwrap();
        let file_root = dir.path().join("not-a-dir");
        fs::write(&file_root, "x").unwrap();
        let target = dir.path().join("report.html");
        fs::write(&target, "x").unwrap();

        let roots = vec![file_root, root];
        // The invalid root is skipped, the real directory root still applies.
        assert!(ensure_within_roots(&target, &roots).is_err());
        let inside = roots[1].join("report.html");
        fs::write(&inside, "x").unwrap();
        assert!(ensure_within_roots(&inside, &roots).is_ok());
    }

    #[test]
    fn missing_roots_do_not_grant_access() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("report.html");
        fs::write(&target, "x").unwrap();
        let missing = dir.path().join("gone");
        let error = ensure_within_roots(&target, &[missing]).unwrap_err();
        assert_eq!(error.code(), "PATH_NOT_ALLOWED");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_parent_cannot_escape_the_write_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("exports");
        let outside = dir.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();

        let target = root.join("link").join("report.json");
        let error = ensure_write_within_roots(&target, &[root]).unwrap_err();
        assert_eq!(error.code(), "PATH_NOT_ALLOWED");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_swap_cannot_redirect_the_resolved_target() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("exports");
        let outside = dir.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        let real = root.join("report.html");
        let evil = outside.join("payload.app");
        fs::write(&real, "report").unwrap();
        fs::write(&evil, "payload").unwrap();
        std::os::unix::fs::symlink(&real, root.join("link.html")).unwrap();

        // The check resolves the link while it still points inside the root.
        let canonical = ensure_within_roots(&root.join("link.html"), std::slice::from_ref(&root))
            .expect("a link inside the root is allowed");
        assert_eq!(canonical, fs::canonicalize(&real).unwrap());

        // Swap the link after the check. Opening the canonical path (what
        // `open_path` now does) still reaches the checked file; the raw request
        // would have followed the new target.
        fs::remove_file(root.join("link.html")).unwrap();
        std::os::unix::fs::symlink(&evil, root.join("link.html")).unwrap();
        assert_eq!(canonical, fs::canonicalize(&real).unwrap());
        assert_eq!(fs::read_to_string(&canonical).unwrap(), "report");
        // And a link that already points outside is rejected outright.
        assert_eq!(
            ensure_within_roots(&root.join("link.html"), std::slice::from_ref(&root))
                .unwrap_err()
                .code(),
            "PATH_NOT_ALLOWED"
        );
    }

    #[test]
    fn paths_with_spaces_and_unicode_are_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().join("Мой проект").join("with space");
        fs::create_dir_all(&parent).unwrap();
        let path = parent.join("seo — копия.toml");
        fs::write(&path, "version = 1\n").unwrap();

        let validated = validate_config_path(&path.display().to_string()).unwrap();
        assert_eq!(validated, path);
        assert_eq!(
            normalize_absolute(&path).unwrap(),
            path,
            "normalization must not touch spaces or non-ASCII characters"
        );
    }

    #[test]
    fn network_and_device_paths_are_rejected() {
        for raw in [
            r"\\attacker\share\data",
            r"\\?\C:\data",
            r"\\.\PhysicalDrive0",
            r"\??\C:\data",
            "//attacker/share/data",
        ] {
            assert!(is_unsafe_share_reference(raw), "{raw}");
            let error = ensure_local_path(raw, "storage.data_dir").unwrap_err();
            assert_eq!(error.code(), "INVALID_PATH", "{raw}");
            assert_eq!(error.details().unwrap()["reason"], "network_or_device_path");
        }
        for raw in [
            r"C:\projects\seo\data",
            "/home/user/project/data",
            "data",
            "~/data",
            "./data",
        ] {
            assert!(!is_unsafe_share_reference(raw), "{raw}");
            assert!(ensure_local_path(raw, "storage.data_dir").is_ok(), "{raw}");
        }
    }

    #[test]
    fn quoted_path_entries_are_unquoted_without_loss() {
        assert_eq!(
            unquote_path(Path::new("\"C:\\Program Files\\LV24\"")),
            Some(PathBuf::from("C:\\Program Files\\LV24"))
        );
        assert_eq!(unquote_path(Path::new("/opt/lv24")), None);
    }

    #[test]
    fn the_first_executable_candidate_wins() {
        let dir = tempfile::tempdir().unwrap();
        let bundled = dir.path().join("bundled").join(engine_exe_name());
        fs::create_dir_all(bundled.parent().unwrap()).unwrap();
        fs::write(&bundled, "binary").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&bundled, fs::Permissions::from_mode(0o755)).unwrap();
        }

        let candidates = vec![
            (dir.path().join("missing").join(engine_exe_name()), "flat"),
            (bundled.clone(), "bundled"),
        ];
        let mut blocked = Vec::new();
        let found = pick_engine(&candidates, &mut blocked).unwrap();
        assert_eq!(found.path, bundled);
        assert_eq!(found.source, "bundled");
        assert!(blocked.is_empty());
    }

    #[test]
    fn an_existing_but_non_executable_engine_is_reported_as_blocked() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first");
        let second = dir.path().join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();

        // No `.exe` extension on Windows, no executable bit on Unix.
        let name = if cfg!(windows) {
            "lv24-seo.txt"
        } else {
            "lv24-seo"
        };
        let not_executable = second.join(name);
        fs::write(&not_executable, "binary").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&not_executable, fs::Permissions::from_mode(0o644)).unwrap();
        }

        let candidates = vec![
            (first.join(engine_exe_name()), "bundled"),
            (not_executable.clone(), "sibling"),
        ];
        let mut blocked = Vec::new();
        assert!(pick_engine(&candidates, &mut blocked).is_none());
        assert_eq!(blocked.len(), 1);
        assert_eq!(blocked[0].0, not_executable);
        assert_eq!(blocked[0].1, "sibling");
    }

    #[test]
    fn appimage_layout_finds_the_engine_under_usr_lib() {
        let dir = tempfile::tempdir().unwrap();
        let appdir = dir.path().join("squashfs-root");
        let engine = appdir
            .join("usr")
            .join("lib")
            .join("LV24 SEO Optimizer")
            .join(ENGINE_DIR)
            .join(ENGINE_FOLDER);
        fs::create_dir_all(&engine).unwrap();
        let exe = engine.join(engine_exe_name());
        fs::write(&exe, "binary").unwrap();

        // An unrelated directory without an engine must be ignored.
        fs::create_dir_all(appdir.join("usr").join("lib").join("other")).unwrap();

        assert_eq!(appdir_candidates(&appdir, engine_exe_name()), vec![exe]);
        assert!(appdir_candidates(&dir.path().join("missing"), engine_exe_name()).is_empty());
    }
}
