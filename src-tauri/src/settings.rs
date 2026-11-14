use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::config::atomic_replace;
use crate::error::AppResult;
use crate::paths::validate_config_path;

pub const SETTINGS_FILE: &str = "settings.json";
pub const MIN_WINDOW_WIDTH: u32 = 960;
pub const MIN_WINDOW_HEIGHT: u32 = 640;
const MAX_WINDOW_WIDTH: u32 = 10_000;
const MAX_WINDOW_HEIGHT: u32 = 10_000;

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
            Ok(raw) => match serde_json::from_str::<Settings>(&raw) {
                Ok(settings) => {
                    let mut settings = settings.sanitized();
                    if let Err(err) = settings.validate() {
                        log::warn!(
                            "clearing invalid config path in desktop settings {}: {err}",
                            path.display()
                        );
                        settings.config_path = None;
                    }
                    settings
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
        let settings = settings.sanitized();
        settings.validate()?;
        let mut guard = self
            .settings
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *guard == settings {
            return Ok(settings);
        }
        self.persist(&settings)?;
        *guard = settings.clone();
        Ok(settings)
    }

    fn persist(&self, settings: &Settings) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_vec_pretty(settings)?;
        let temporary = self.path.with_file_name(format!(
            ".{}.{}.tmp",
            self.path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(SETTINGS_FILE),
            std::process::id()
        ));
        fs::write(&temporary, raw)?;
        if let Err(err) = atomic_replace(&temporary, &self.path) {
            let _ = fs::remove_file(&temporary);
            return Err(err);
        }
        Ok(())
    }
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
