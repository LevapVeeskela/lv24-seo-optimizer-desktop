use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

pub const APP_IDENTIFIER: &str = "by.lv24.seo.desktop";
pub const ENGINE_ENV: &str = "LV24_SEO_BIN";
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
            fs::create_dir_all(dir)?;
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
/// `engine/lv24-seo/lv24-seo[.exe]`, sibling `lv24-seo/lv24-seo[.exe]`, PATH.
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
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push((
            resource_dir
                .join(ENGINE_DIR)
                .join(ENGINE_FOLDER)
                .join(exe_name),
            "bundled",
        ));
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push((parent.join(ENGINE_FOLDER).join(exe_name), "sibling"));
        }
    }

    for (candidate, source) in &candidates {
        if candidate.is_file() && is_executable(candidate) {
            return Ok(EngineLocation {
                path: candidate.clone(),
                source: (*source).to_string(),
            });
        }
    }

    if let Some(path) = find_on_path(exe_name) {
        return Ok(EngineLocation {
            path,
            source: "PATH".to_string(),
        });
    }

    Err(AppError::new(
        "ENGINE_NOT_FOUND",
        format!(
            "lv24-seo engine not found; set {ENGINE_ENV} to an absolute executable path, bundle \
             {ENGINE_DIR}/{ENGINE_FOLDER}/{exe_name}, or put {exe_name} on PATH"
        ),
    )
    .with_details(serde_json::json!({
        "candidates": candidates
            .iter()
            .map(|(path, source)| serde_json::json!({
                "path": path.display().to_string(),
                "source": source,
            }))
            .collect::<Vec<_>>(),
    })))
}

fn env_nonempty(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().trim_matches('"').to_string())
        .filter(|value| !value.is_empty())
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let raw = env::var_os("PATH")?;
    for dir in env::split_paths(&raw) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let dir = PathBuf::from(dir.to_string_lossy().trim_matches('"').to_string());
        let candidate = dir.join(name);
        if candidate.is_file() && is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
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
    if is_reserved_windows_name(name) {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("{label} path uses a reserved Windows file name: {name}"),
        ));
    }
    #[cfg(windows)]
    if name
        .chars()
        .any(|ch| matches!(ch, ':' | '*' | '?' | '<' | '>' | '|' | '"'))
    {
        return Err(AppError::new(
            "INVALID_PATH",
            format!("{label} path contains characters invalid on Windows: {name}"),
        ));
    }
    Ok(normalized)
}

#[cfg(windows)]
fn is_reserved_windows_name(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return true;
    }
    stem.len() == 4
        && (stem.starts_with("COM") || stem.starts_with("LPT"))
        && stem.as_bytes()[3].is_ascii_digit()
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

/// Resolve `path` and require it to live under one of `roots`.
pub fn ensure_within_roots(path: &Path, roots: &[PathBuf]) -> AppResult<PathBuf> {
    let canonical = fs::canonicalize(path).map_err(|err| {
        AppError::new(
            "PATH_NOT_FOUND",
            format!("cannot resolve {}: {err}", path.display()),
        )
    })?;
    for root in roots {
        let Ok(canonical_root) = fs::canonicalize(root) else {
            continue;
        };
        if canonical_root.parent().is_none() {
            continue;
        }
        if path_starts_with(&canonical, &canonical_root) {
            return Ok(canonical);
        }
    }
    Err(AppError::new(
        "PATH_NOT_ALLOWED",
        format!(
            "{} is outside the approved config/data directories",
            path.display()
        ),
    )
    .with_details(serde_json::json!({
        "path": path.display().to_string(),
        "roots": roots.iter().map(|root| root.display().to_string()).collect::<Vec<_>>(),
    })))
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
    for root in roots {
        let Ok(canonical_root) = fs::canonicalize(root) else {
            continue;
        };
        if canonical_root.parent().is_none() {
            continue;
        }
        if path_starts_with(&canonical_parent, &canonical_root) {
            let name = path
                .file_name()
                .ok_or_else(|| AppError::new("INVALID_PATH", "path has no file name"))?;
            return Ok(canonical_parent.join(name));
        }
    }
    Err(AppError::new(
        "PATH_NOT_ALLOWED",
        format!(
            "{} is outside the approved config/data directories",
            path.display()
        ),
    )
    .with_details(serde_json::json!({
        "path": path.display().to_string(),
        "roots": roots.iter().map(|root| root.display().to_string()).collect::<Vec<_>>(),
    })))
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
        for name in ["CON.toml", "NUL.toml", "COM1.toml", "LPT9.toml"] {
            let path = dir.path().join(name);
            let error = validate_config_path(&path.display().to_string()).unwrap_err();
            assert_eq!(error.code(), "INVALID_PATH", "{name}");
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
}
