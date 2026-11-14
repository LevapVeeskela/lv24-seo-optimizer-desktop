use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::install_temp;
use crate::error::{AppError, AppResult};
use crate::paths::validate_config_path;

pub const SETTINGS_FILE: &str = "settings.json";
pub const MIN_WINDOW_WIDTH: u32 = 960;
pub const MIN_WINDOW_HEIGHT: u32 = 640;
const MAX_WINDOW_WIDTH: u32 = 10_000;
const MAX_WINDOW_HEIGHT: u32 = 10_000;
/// Guard against absurd stored coordinates (`i32::MIN`..`i32::MAX`) that would
/// place the window far outside any monitor arrangement.
const MAX_WINDOW_COORD: i32 = 100_000;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct WindowBounds {
    pub width: u32,
    pub height: u32,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub maximized: bool,
}

impl Default for WindowBounds {
    fn default() -> Self {
        Self {
            width: 1180,
            height: 700,
            x: None,
            y: None,
            maximized: false,
        }
    }
}

impl WindowBounds {
    fn sanitized(mut self) -> Self {
        self.width = self.width.clamp(MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH);
        self.height = self.height.clamp(MIN_WINDOW_HEIGHT, MAX_WINDOW_HEIGHT);
        self.x = self
            .x
            .map(|value| value.clamp(-MAX_WINDOW_COORD, MAX_WINDOW_COORD));
        self.y = self
            .y
            .map(|value| value.clamp(-MAX_WINDOW_COORD, MAX_WINDOW_COORD));
        self
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Absolute path to the project's `seo.toml`, or `null` during onboarding.
    pub config_path: Option<String>,
    /// Desktop UI language only; report.locale is a project setting.
    pub ui_locale: String,
    pub window_bounds: WindowBounds,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            config_path: None,
            ui_locale: "en".to_string(),
            window_bounds: WindowBounds::default(),
        }
    }
}

impl Settings {
    pub fn sanitized(mut self) -> Self {
        self.config_path = self
            .config_path
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        self.ui_locale = match self.ui_locale.trim().to_ascii_lowercase().as_str() {
            "ru" => "ru",
            "zh" => "zh",
            _ => "en",
        }
        .to_string();
        self.window_bounds = self.window_bounds.sanitized();
        self
    }

    /// Read settings field by field. A single hand-edited value of the wrong
    /// type (`"width": "big"`) must not discard the whole file, because that
    /// would silently drop the selected project config.
    fn from_value(value: &Value) -> Self {
        let mut settings = Settings::default();
        if let Some(raw) = text_field(value, &["configPath", "config_path"]) {
            settings.config_path = Some(raw.to_string());
        }
        if let Some(raw) = text_field(value, &["uiLocale", "ui_locale"]) {
            settings.ui_locale = raw.to_string();
        }
        if let Some(bounds) = ["windowBounds", "window_bounds"]
            .iter()
            .find_map(|key| value.get(*key))
            .filter(|bounds| bounds.is_object())
        {
            if let Some(width) = u32_field(bounds, "width") {
                settings.window_bounds.width = width;
            }
            if let Some(height) = u32_field(bounds, "height") {
                settings.window_bounds.height = height;
            }
            if let Some(x) = i32_field(bounds, "x") {
                settings.window_bounds.x = Some(x);
            }
            if let Some(y) = i32_field(bounds, "y") {
                settings.window_bounds.y = Some(y);
            }
            if let Some(maximized) = bounds.get("maximized").and_then(Value::as_bool) {
                settings.window_bounds.maximized = maximized;
            }
        }
        settings
    }

    pub fn validate(&self) -> AppResult<()> {
        if let Some(raw) = &self.config_path {
            // Use the same validation as the config commands so `settings_set`
            // cannot persist a path that a later command rejects (relative,
            // non-TOML, missing parent, reserved Windows name, directory).
            validate_config_path(raw)?;
        }
        Ok(())
    }
}

fn text_field<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(Value::as_str)
}

fn u32_field(value: &Value, key: &str) -> Option<u32> {
    let raw = value.get(key)?;
    raw.as_u64()
        .and_then(|number| u32::try_from(number).ok())
        .or_else(|| raw.as_str().and_then(|text| text.trim().parse().ok()))
}

fn i32_field(value: &Value, key: &str) -> Option<i32> {
    let raw = value.get(key)?;
    raw.as_i64()
        .and_then(|number| i32::try_from(number).ok())
        .or_else(|| raw.as_str().and_then(|text| text.trim().parse().ok()))
}

/// Partial settings update. A full [`Settings`] object also deserializes into
/// this shape, so the webview may send either a whole object or one changed
/// section without wiping the other fields.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub config_path: Option<String>,
    pub ui_locale: Option<String>,
    pub window_bounds: Option<WindowBounds>,
    /// Explicitly clear `config_path`; `null` alone means "leave unchanged".
    pub clear_config_path: bool,
}

impl SettingsPatch {
    pub fn apply_to(self, mut base: Settings) -> Settings {
        if self.clear_config_path {
            base.config_path = None;
        }
        if let Some(config_path) = self.config_path {
            base.config_path = Some(config_path);
        }
        if let Some(ui_locale) = self.ui_locale {
            base.ui_locale = ui_locale;
        }
        if let Some(window_bounds) = self.window_bounds {
            base.window_bounds = window_bounds;
        }
        base
    }
}

pub struct SettingsStore {
    path: PathBuf,
    settings: Mutex<Settings>,
}

impl SettingsStore {
    /// Missing or corrupt settings fall back to defaults; they never block the
    /// app from starting.
    pub fn load(path: PathBuf) -> AppResult<Self> {
        let settings = match fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<Value>(&raw) {
                Ok(value) if value.is_object() => {
                    let mut settings = Settings::from_value(&value).sanitized();
                    if let Err(err) = settings.validate() {
                        log::warn!(
                            "clearing invalid config path in desktop settings {}: {err}",
                            path.display()
                        );
                        settings.config_path = None;
                    }
                    settings
                }
                Ok(_) => {
                    log::warn!(
                        "ignoring desktop settings at {}: the file is not a JSON object",
                        path.display()
                    );
                    Settings::default()
                }
                Err(err) => {
                    log::warn!(
                        "ignoring invalid desktop settings at {}: {err}",
                        path.display()
                    );
                    Settings::default()
                }
            },
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(err) => {
                log::warn!(
                    "cannot read desktop settings {}: {err}; using defaults",
                    path.display()
                );
                Settings::default()
            }
        };
        Ok(Self {
            path,
            settings: Mutex::new(settings),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn get(&self) -> Settings {
        self.settings
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn set(&self, settings: Settings) -> AppResult<Settings> {
        let mut settings = settings.sanitized();
        let mut guard = self
            .settings
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // Only a newly chosen project config is validated strictly. An already
        // stored path that has since become invalid (project folder moved, a
        // network share that is offline) must not block unrelated updates such
        // as window bounds or the UI locale; `load` clears it on the next start
        // and the UI already reports a missing config.
        if settings.config_path != guard.config_path {
            if let Some(raw) = settings.config_path.as_deref() {
                // Persist the normalized path (no `.` segments, no trailing
                // separator) so later `same_path` comparisons against a picked
                // file succeed.
                settings.config_path = Some(validate_config_path(raw)?.display().to_string());
            }
        }
        if *guard == settings {
            return Ok(settings);
        }
        self.persist(&settings)?;
        *guard = settings.clone();
        Ok(settings)
    }

    fn persist(&self, settings: &Settings) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                AppError::new(
                    "SETTINGS_WRITE",
                    format!("cannot create {}: {err}", parent.display()),
                )
            })?;
        }
        let raw = serde_json::to_vec_pretty(settings)?;
        let temporary = self.temp_path();
        write_private_temp(&temporary, &raw).map_err(|err| {
            AppError::new(
                "SETTINGS_WRITE",
                format!("cannot write {}: {err}", temporary.display()),
            )
        })?;
        if let Err(err) = install_temp(&temporary, &self.path) {
            let _ = fs::remove_file(&temporary);
            return Err(AppError::new(
                "SETTINGS_WRITE",
                format!("cannot replace {}: {}", self.path.display(), err.message()),
            )
            .with_details(
                err.details().unwrap_or_else(
                    || serde_json::json!({ "path": self.path.display().to_string() }),
                ),
            ));
        }
        Ok(())
    }

    /// A per-write temp name: two stores (or two windows) in one process must
    /// not share a temp file and interleave their JSON.
    fn temp_path(&self) -> PathBuf {
        let name = self
            .path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(SETTINGS_FILE);
        let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        self.path
            .with_file_name(format!(".{name}.{}.{}.tmp", std::process::id(), sequence))
    }
}

/// Create the temp file exclusively (never truncate someone else's), write the
/// JSON and flush it before the rename.
fn write_private_temp(path: &Path, raw: &[u8]) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(raw)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_settings_load_as_defaults_and_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SETTINGS_FILE);
        let store = SettingsStore::load(path.clone()).unwrap();
        assert_eq!(store.get(), Settings::default());

        let mut settings = store.get();
        settings.config_path = Some(dir.path().join("seo.toml").display().to_string());
        settings.ui_locale = "ru".to_string();
        settings.window_bounds.width = 1600;
        settings.window_bounds.height = 900;
        store.set(settings.clone()).unwrap();

        let reloaded = SettingsStore::load(path).unwrap();
        assert_eq!(reloaded.get(), settings);
    }

    #[test]
    fn corrupt_settings_fall_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SETTINGS_FILE);
        fs::write(&path, "{not json").unwrap();
        let store = SettingsStore::load(path).unwrap();
        assert_eq!(store.get(), Settings::default());
    }

    #[test]
    fn a_non_object_settings_file_falls_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SETTINGS_FILE);
        fs::write(&path, "[]").unwrap();
        let store = SettingsStore::load(path).unwrap();
        assert_eq!(store.get(), Settings::default());
    }

    #[test]
    fn one_malformed_field_does_not_discard_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SETTINGS_FILE);
        let config = dir.path().join("seo.toml");
        fs::write(&config, "version = 1\n").unwrap();
        fs::write(
            &path,
            format!(
                r#"{{"configPath": {:?}, "uiLocale": "ru",
                    "windowBounds": {{"width": "wide", "height": 900, "x": "left"}}}}"#,
                config.display().to_string()
            ),
        )
        .unwrap();

        let store = SettingsStore::load(path).unwrap();
        let settings = store.get();
        assert_eq!(settings.config_path, Some(config.display().to_string()));
        assert_eq!(settings.ui_locale, "ru");
        // The bad values fall back to their defaults instead of failing the
        // whole document.
        assert_eq!(settings.window_bounds.width, WindowBounds::default().width);
        assert_eq!(settings.window_bounds.height, 900);
        assert_eq!(settings.window_bounds.x, None);
    }

    #[test]
    fn numeric_strings_and_snake_case_keys_are_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SETTINGS_FILE);
        fs::write(
            &path,
            r#"{"ui_locale":"zh","window_bounds":{"width":"1400","height":"800","maximized":true},
                "futureField":{"ignored":true}}"#,
        )
        .unwrap();
        let store = SettingsStore::load(path).unwrap();
        let settings = store.get();
        assert_eq!(settings.ui_locale, "zh");
        assert_eq!(settings.window_bounds.width, 1400);
        assert_eq!(settings.window_bounds.height, 800);
        assert!(settings.window_bounds.maximized);
    }

    #[test]
    fn absurd_window_coordinates_are_clamped() {
        let settings = WindowBounds {
            x: Some(i32::MIN),
            y: Some(i32::MAX),
            ..WindowBounds::default()
        }
        .sanitized();
        assert_eq!(settings.x, Some(-MAX_WINDOW_COORD));
        assert_eq!(settings.y, Some(MAX_WINDOW_COORD));
        assert_eq!(WindowBounds::default().sanitized().x, None);
    }

    #[test]
    fn an_invalid_stored_config_does_not_block_unrelated_updates() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        fs::create_dir(&project).unwrap();
        let config = project.join("seo.toml");
        fs::write(&config, "version = 1\n").unwrap();
        let path = dir.path().join(SETTINGS_FILE);
        let store = SettingsStore::load(path.clone()).unwrap();

        let mut settings = store.get();
        settings.config_path = Some(config.display().to_string());
        store.set(settings).unwrap();

        // The project folder disappears while the app is running.
        fs::remove_dir_all(&project).unwrap();

        let mut settings = store.get();
        settings.window_bounds.width = 1600;
        settings.ui_locale = "ru".to_string();
        let saved = store.set(settings).unwrap();
        assert_eq!(saved.window_bounds.width, 1600);
        assert_eq!(saved.ui_locale, "ru");

        // The stored path survives until the next load, which clears it.
        assert!(store.get().config_path.is_some());
        let reloaded = SettingsStore::load(path).unwrap();
        assert_eq!(reloaded.get().config_path, None);
        assert_eq!(reloaded.get().window_bounds.width, 1600);
    }

    #[test]
    fn a_new_invalid_config_path_is_still_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(dir.path().join(SETTINGS_FILE)).unwrap();
        let mut settings = store.get();
        settings.config_path = Some(
            dir.path()
                .join("missing")
                .join("seo.toml")
                .display()
                .to_string(),
        );
        let error = store.set(settings).unwrap_err();
        assert_eq!(error.code(), "INVALID_PATH");
        assert_eq!(store.get().config_path, None);
    }

    #[test]
    fn a_chosen_config_path_is_stored_normalized() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("seo.toml");
        fs::write(&config, "version = 1\n").unwrap();
        let store = SettingsStore::load(dir.path().join(SETTINGS_FILE)).unwrap();
        let mut settings = store.get();
        settings.config_path = Some(dir.path().join(".").join("seo.toml").display().to_string());
        let saved = store.set(settings).unwrap();
        assert_eq!(saved.config_path, Some(config.display().to_string()));
    }

    #[test]
    fn concurrent_updates_leave_one_valid_file_and_no_temp_debris() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SETTINGS_FILE);
        let store = std::sync::Arc::new(SettingsStore::load(path.clone()).unwrap());

        let handles: Vec<_> = (0..8)
            .map(|index| {
                let store = std::sync::Arc::clone(&store);
                std::thread::spawn(move || {
                    let mut settings = store.get();
                    settings.window_bounds.width = 1000 + index * 10;
                    settings.window_bounds.height = 700 + index * 10;
                    store.set(settings)
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap().unwrap();
        }

        let reloaded = SettingsStore::load(path).unwrap();
        let bounds = reloaded.get().window_bounds;
        assert!((1000..=1070).contains(&bounds.width), "{}", bounds.width);
        assert!((700..=770).contains(&bounds.height), "{}", bounds.height);

        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp debris: {leftovers:?}");
    }

    #[test]
    fn settings_writes_replace_the_file_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SETTINGS_FILE);
        let store = SettingsStore::load(path.clone()).unwrap();
        let mut settings = store.get();
        settings.ui_locale = "zh".to_string();
        store.set(settings).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["uiLocale"], "zh");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "settings mode was {mode:o}");
        }
    }

    #[test]
    fn invalid_config_path_is_cleared_without_losing_other_settings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SETTINGS_FILE);
        fs::write(
            &path,
            r#"{"configPath":"seo.toml","uiLocale":"ru","windowBounds":{"width":1440,"height":900}}"#,
        )
        .unwrap();
        let store = SettingsStore::load(path).unwrap();
        assert_eq!(store.get().config_path, None);
        assert_eq!(store.get().ui_locale, "ru");
        assert_eq!(store.get().window_bounds.width, 1440);
    }

    #[test]
    fn locale_and_bounds_are_sanitized() {
        let settings = Settings {
            config_path: Some("  ".to_string()),
            ui_locale: "DE".to_string(),
            window_bounds: WindowBounds {
                width: 100,
                height: 99_999,
                ..WindowBounds::default()
            },
        }
        .sanitized();
        assert_eq!(settings.config_path, None);
        assert_eq!(settings.ui_locale, "en");
        assert_eq!(settings.window_bounds.width, MIN_WINDOW_WIDTH);
        assert_eq!(settings.window_bounds.height, MAX_WINDOW_HEIGHT);
    }

    #[test]
    fn relative_config_path_is_rejected_on_set() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(dir.path().join(SETTINGS_FILE)).unwrap();
        let mut settings = store.get();
        settings.config_path = Some("seo.toml".to_string());
        let error = store.set(settings).unwrap_err();
        assert_eq!(error.code(), "INVALID_PATH");
    }

    #[test]
    fn config_parent_must_be_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(dir.path().join(SETTINGS_FILE)).unwrap();

        let mut settings = store.get();
        settings.config_path = Some(
            dir.path()
                .join("missing")
                .join("seo.toml")
                .display()
                .to_string(),
        );
        let error = store.set(settings).unwrap_err();
        assert_eq!(error.code(), "INVALID_PATH");

        let not_a_dir = dir.path().join("not-a-dir");
        fs::write(&not_a_dir, "x").unwrap();
        let mut settings = store.get();
        settings.config_path = Some(not_a_dir.join("seo.toml").display().to_string());
        let error = store.set(settings).unwrap_err();
        assert_eq!(error.code(), "INVALID_PATH");
    }

    #[test]
    fn partial_settings_patch_preserves_other_fields() {
        let base = Settings {
            config_path: Some(std::env::temp_dir().join("seo.toml").display().to_string()),
            ui_locale: "ru".to_string(),
            window_bounds: WindowBounds::default(),
        };
        let patch = SettingsPatch {
            window_bounds: Some(WindowBounds {
                width: 1440,
                height: 900,
                ..WindowBounds::default()
            }),
            ..SettingsPatch::default()
        };
        let updated = patch.apply_to(base.clone());
        assert_eq!(updated.config_path, base.config_path);
        assert_eq!(updated.ui_locale, "ru");
        assert_eq!(updated.window_bounds.width, 1440);
    }
}
