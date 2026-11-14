use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use toml_edit::{DocumentMut, Item, Table, TableLike, Value as TomlValue};

use crate::cli::{self, CliArgs, CliCommandId};
use crate::error::{AppError, AppResult};
use crate::paths::EngineLocation;

const BACKUP_KEEP: usize = 5;
pub const MAX_CONFIG_BYTES: u64 = 8 * 1024 * 1024;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationOutcome {
    pub valid: bool,
    pub exit_code: Option<i32>,
    pub envelope: Value,
    pub stderr: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    pub path: String,
    pub backup: Option<String>,
    pub bytes: usize,
}

/// One settings-form change. Either `path` (`report.locale`) or
/// `section` + `key` (`report.email` + `enabled`) identifies the TOML key.
/// A JSON `null` removes the key.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Patch {
    #[serde(default)]
    pub section: Option<String>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    pub value: Value,
}

impl Patch {
    fn segments(&self) -> AppResult<Vec<String>> {
        match (&self.path, &self.section, &self.key) {
            (Some(path), None, None) => split_patch_path(path),
            (None, Some(section), Some(key)) => {
                let mut segments = split_patch_path(section)?;
                let key = key.trim();
                if key.is_empty() {
                    return Err(AppError::new("CONFIG_PATCH", "patch key is empty"));
                }
                validate_patch_segment(key)?;
                segments.push(key.to_string());
                Ok(segments)
            }
            (Some(_), _, _) => Err(AppError::new(
                "CONFIG_PATCH",
                "use either path or section+key, not both",
            )),
            _ => Err(AppError::new(
                "CONFIG_PATCH",
                "patch needs path or section+key",
            )),
        }
    }
}

fn split_patch_path(raw: &str) -> AppResult<Vec<String>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new("CONFIG_PATCH", "patch path is empty"));
    }
    if trimmed != raw {
        return Err(AppError::new(
            "CONFIG_PATCH",
            "patch path must not have leading or trailing whitespace",
        ));
    }
    let segments: Vec<String> = trimmed
        .split('.')
        .map(|segment| segment.to_string())
        .collect();
    if segments.len() > 16 {
        return Err(AppError::new(
            "CONFIG_PATCH",
            "patch path is deeper than 16 segments",
        ));
    }
    for segment in &segments {
        validate_patch_segment(segment)?;
    }
    Ok(segments)
}

fn validate_patch_segment(segment: &str) -> AppResult<()> {
    if segment.is_empty() {
        return Err(AppError::new(
            "CONFIG_PATCH",
            "patch path has an empty segment",
        ));
    }
    if segment.len() > 64 {
        return Err(AppError::new(
            "CONFIG_PATCH",
            format!("patch segment is longer than 64 characters: {segment:?}"),
        ));
    }
    if !segment
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err(AppError::new(
            "CONFIG_PATCH",
            format!("patch segment contains unsupported characters: {segment:?}"),
        ));
    }
    Ok(())
}

/// Apply patches to a parsed document, preserving comments and key order.
pub fn apply_patches(document: &mut DocumentMut, patches: &[Patch]) -> AppResult<()> {
    if patches.len() > 512 {
        return Err(AppError::new(
            "CONFIG_PATCH",
            "more than 512 patches in one request",
        ));
    }
    for patch in patches {
        let segments = patch.segments()?;
        if patch.value.is_null() {
            remove_path(document.as_table_mut(), &segments)?;
        } else {
            let mut item = Item::Value(json_to_toml_value(&patch.value)?);
            set_path(document.as_table_mut(), &segments, &mut item)?;
        }
    }
    Ok(())
}

fn set_path(table: &mut Table, segments: &[String], item: &mut Item) -> AppResult<()> {
    let (last, parents) = segments
        .split_last()
        .ok_or_else(|| AppError::new("CONFIG_PATCH", "patch path is empty"))?;
    let mut current: &mut dyn TableLike = table;
    for segment in parents {
        if !current.contains_key(segment) {
            current.insert(segment, Item::Table(Table::new()));
        }
        let entry = current
            .get_mut(segment)
            .ok_or_else(|| AppError::new("CONFIG_PATCH", "cannot create a table"))?;
        current = item_as_table_like(entry).ok_or_else(|| {
            AppError::new(
                "CONFIG_PATCH",
                format!("{segment} exists but is not a table"),
            )
        })?;
    }
    if let Item::Value(new_value) = item {
        if let Some(old_value) = current.get(last).and_then(Item::as_value) {
            *new_value.decor_mut() = old_value.decor().clone();
        }
    }
    current.insert(last, item.clone());
    Ok(())
}

fn item_as_table_like(item: &mut Item) -> Option<&mut dyn TableLike> {
    match item {
        Item::Table(table) => Some(table),
        Item::Value(TomlValue::InlineTable(table)) => Some(table),
        _ => None,
    }
}

fn remove_path(table: &mut Table, segments: &[String]) -> AppResult<()> {
    let (last, parents) = segments
        .split_last()
        .ok_or_else(|| AppError::new("CONFIG_PATCH", "patch path is empty"))?;
    let mut current: &mut dyn TableLike = table;
    for segment in parents {
        let Some(entry) = current.get_mut(segment) else {
            return Ok(());
        };
        current = item_as_table_like(entry).ok_or_else(|| {
            AppError::new(
                "CONFIG_PATCH",
                format!("{segment} exists but is not a table"),
            )
        })?;
    }
    current.remove(last);
    Ok(())
}

fn json_to_toml_value(value: &Value) -> AppResult<toml_edit::Value> {
    match value {
        Value::Null => Err(AppError::new(
            "CONFIG_PATCH",
            "null is only supported as a top-level key removal",
        )),
        Value::Bool(value) => Ok(toml_edit::Value::from(*value)),
        Value::Number(value) => {
            if let Some(integer) = value.as_i64() {
                Ok(toml_edit::Value::from(integer))
            } else if let Some(float) = value.as_f64() {
                Ok(toml_edit::Value::from(float))
            } else {
                Err(AppError::new(
                    "CONFIG_PATCH",
                    format!("number {value} cannot be represented in TOML"),
                ))
            }
        }
        Value::String(value) => Ok(toml_edit::Value::from(value.clone())),
        Value::Array(items) => {
            let mut array = toml_edit::Array::new();
            for item in items {
                array.push(json_to_toml_value(item)?);
            }
            Ok(toml_edit::Value::Array(array))
        }
        Value::Object(map) => {
            let mut table = toml_edit::InlineTable::new();
            for (key, item) in map {
                table.insert(key, json_to_toml_value(item)?);
            }
            Ok(toml_edit::Value::InlineTable(table))
        }
    }
}

pub fn read_raw(path: &Path) -> AppResult<String> {
    if let Ok(metadata) = fs::metadata(path) {
        if metadata.len() > MAX_CONFIG_BYTES {
            return Err(AppError::new(
                "CONFIG_READ",
                format!(
                    "config {} is larger than {} bytes",
                    path.display(),
                    MAX_CONFIG_BYTES
                ),
            ));
        }
    }
    fs::read_to_string(path).map_err(|err| {
        AppError::new(
            "CONFIG_READ",
            format!("cannot read config {}: {err}", path.display()),
        )
    })
}

pub fn parse_toml(content: &str) -> AppResult<DocumentMut> {
    content.parse::<DocumentMut>().map_err(AppError::from)
}

/// Resolve `storage.data_dir` the same way the engine does: relative values are
/// relative to the config file's parent, not the desktop's cwd. `~/` is
/// expanded with HOME/USERPROFILE because the desktop has no shell.
pub fn data_dir_from_document(document: &DocumentMut, config_path: &Path) -> Option<PathBuf> {
    let raw = document
        .get("storage")
        .and_then(|storage| storage.get("data_dir"))
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    Some(resolve_data_dir(raw, config_path))
}

pub fn resolve_data_dir(raw: &str, config_path: &Path) -> PathBuf {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            return PathBuf::from(home).join(rest);
        }
    }
    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        path
    } else {
        config_path
            .parent()
            .map(|parent| parent.join(path.clone()))
            .unwrap_or(path)
    }
}

/// Write `content` to a unique temporary file next to `target`.
pub fn stage_temp(target: &Path, content: &str) -> AppResult<PathBuf> {
    let parent = target.parent().ok_or_else(|| {
        AppError::new(
            "CONFIG_WRITE",
            format!("config path has no parent: {}", target.display()),
        )
    })?;
    if !parent.is_dir() {
        return Err(AppError::new(
            "CONFIG_WRITE",
            format!("config parent is not a directory: {}", parent.display()),
        ));
    }
    let base = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("seo.toml");

    for _ in 0..16 {
        let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".{base}.{}.{}.tmp", std::process::id(), sequence));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => {
                finish_temp(file, &candidate, content)?;
                return Ok(candidate);
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => {
                return Err(AppError::new(
                    "CONFIG_WRITE",
                    format!("cannot create {}: {err}", candidate.display()),
                ))
            }
        }
    }
    Err(AppError::new(
        "CONFIG_WRITE",
        format!(
            "cannot allocate a temporary file next to {}",
            target.display()
        ),
    ))
}

/// Write and fsync a freshly created temp file. On failure the partial file is
/// removed so a failed write never leaves debris next to the config.
fn finish_temp(mut file: fs::File, candidate: &Path, content: &str) -> AppResult<()> {
    let written = file
        .write_all(content.as_bytes())
        .and_then(|()| file.sync_all());
    if let Err(err) = written {
        drop(file);
        let _ = fs::remove_file(candidate);
        return Err(err.into());
    }
    Ok(())
}

/// Back up the existing target (keep the last five) and atomically replace it
/// with `temp`. The caller has already validated the temp file.
pub fn commit_temp(temp: &Path, target: &Path) -> AppResult<WriteOutcome> {
    if !temp.is_file() {
        return Err(AppError::new(
            "CONFIG_WRITE",
            format!("temporary file is missing: {}", temp.display()),
        ));
    }
    let mut backup = None;
    let existing_permissions = match fs::metadata(target) {
        Ok(metadata) => {
            if metadata.is_dir() {
                return Err(AppError::new(
                    "CONFIG_WRITE",
                    format!("config path is a directory: {}", target.display()),
                ));
            }
            let backup_path = backup_path(target)?;
            fs::copy(target, &backup_path).map_err(|err| {
                AppError::new(
                    "CONFIG_WRITE",
                    format!(
                        "cannot back up {} to {}: {err}",
                        target.display(),
                        backup_path.display()
                    ),
                )
            })?;
            prune_backups(target, BACKUP_KEEP)?;
            backup = Some(backup_path);
            Some(metadata.permissions())
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => {
            return Err(AppError::new(
                "CONFIG_WRITE",
                format!("cannot inspect {}: {err}", target.display()),
            ))
        }
    };

    if let Some(permissions) = existing_permissions {
        fs::set_permissions(temp, permissions).map_err(|err| {
            AppError::new(
                "CONFIG_WRITE",
                format!("cannot preserve permissions on {}: {err}", temp.display()),
            )
        })?;
    }

    atomic_replace(temp, target)?;
    let bytes = fs::metadata(target)
        .map(|meta| meta.len() as usize)
        .unwrap_or(0);
    Ok(WriteOutcome {
        path: target.display().to_string(),
        backup: backup.map(|path| path.display().to_string()),
        bytes,
    })
}

/// Convenience path used by tests and by callers that already validated the
/// content. Production writes go through [`stage_temp`] + engine validation +
/// [`commit_temp`].
#[cfg(test)]
pub fn write_atomic_unchecked(target: &Path, content: &str) -> AppResult<WriteOutcome> {
    let temp = stage_temp(target, content)?;
    match commit_temp(&temp, target) {
        Ok(outcome) => Ok(outcome),
        Err(err) => {
            let _ = fs::remove_file(&temp);
            Err(err)
        }
    }
}

/// Atomic text export without a config backup. Used for agent task exports
/// after the caller has checked the path allow-list.
pub fn write_text_atomic(target: &Path, content: &str) -> AppResult<WriteOutcome> {
    let temp = stage_temp(target, content)?;
    match atomic_replace(&temp, target) {
        Ok(()) => {
            let bytes = fs::metadata(target)
                .map(|meta| meta.len() as usize)
                .unwrap_or(0);
            Ok(WriteOutcome {
                path: target.display().to_string(),
                backup: None,
                bytes,
            })
        }
        Err(err) => {
            let _ = fs::remove_file(&temp);
            Err(err)
        }
    }
}

/// Validate `content` by staging it next to `target` and running
/// `lv24-seo config show --config <temp> --json`.
pub async fn validate_with_engine(
    location: &EngineLocation,
    target: &Path,
    content: &str,
) -> AppResult<ValidationOutcome> {
    validate_with_engine_in(location, target, content, None).await
}

/// Same as [`validate_with_engine`], but when the directory next to `target`
/// is read-only the draft is staged in `fallback_dir` (the app config dir) so a
/// valid file can still be checked before the user fixes permissions.
pub(crate) async fn validate_with_engine_in(
    location: &EngineLocation,
    target: &Path,
    content: &str,
    fallback_dir: Option<&Path>,
) -> AppResult<ValidationOutcome> {
    let temp = stage_validation_temp(target, content, fallback_dir)?;
    let result = cli::run(
        location,
        Some(&temp),
        CliCommandId::ConfigShow,
        &CliArgs::default(),
    )
    .await;
    let _ = fs::remove_file(&temp);
    let result = result?;
    let valid = result
        .envelope
        .get("ok")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(ValidationOutcome {
        valid,
        exit_code: result.exit_code,
        envelope: result.envelope,
        stderr: result.stderr,
    })
}

fn stage_validation_temp(
    target: &Path,
    content: &str,
    fallback_dir: Option<&Path>,
) -> AppResult<PathBuf> {
    match stage_temp(target, content) {
        Ok(temp) => Ok(temp),
        Err(primary) => match fallback_dir {
            Some(dir) => stage_temp(&dir.join("seo.toml"), content),
            None => Err(primary),
        },
    }
}

pub(crate) fn atomic_replace(temp: &Path, target: &Path) -> AppResult<()> {
    match fs::rename(temp, target) {
        Ok(()) => Ok(()),
        Err(first) => {
            #[cfg(windows)]
            {
                // `std::fs::rename` replaces an existing file on Windows, but
                // it can still fail when the destination is locked (antivirus,
                // an editor, a running engine). Move the old file aside,
                // install the new one, then delete the old copy. The backup
                // written by commit_temp is the recovery point if this process
                // dies in between.
                if target.exists() {
                    let name = target
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("seo.toml");
                    let old = target.with_file_name(format!(
                        ".{name}.old-{}-{}",
                        std::process::id(),
                        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
                    ));
                    fs::rename(target, &old).map_err(|err| {
                        AppError::new(
                            "CONFIG_WRITE",
                            format!(
                                "cannot move {} aside after rename failed ({first}): {err}",
                                target.display()
                            ),
                        )
                    })?;
                    match fs::rename(temp, target) {
                        Ok(()) => {
                            let _ = fs::remove_file(&old);
                            Ok(())
                        }
                        Err(second) => {
                            let _ = fs::rename(&old, target);
                            Err(AppError::new(
                                "CONFIG_WRITE",
                                format!(
                                    "cannot replace {}: {second} (restored the previous file)",
                                    target.display()
                                ),
                            ))
                        }
                    }
                } else {
                    Err(AppError::new(
                        "CONFIG_WRITE",
                        format!(
                            "cannot rename temporary config to {}: {first}",
                            target.display()
                        ),
                    ))
                }
            }
            #[cfg(not(windows))]
            {
                Err(AppError::new(
                    "CONFIG_WRITE",
                    format!(
                        "cannot rename temporary config to {}: {first}",
                        target.display()
                    ),
                ))
            }
        }
    }
}

fn backup_path(target: &Path) -> AppResult<PathBuf> {
    let parent = target.parent().ok_or_else(|| {
        AppError::new(
            "CONFIG_WRITE",
            format!("config path has no parent: {}", target.display()),
        )
    })?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::new("CONFIG_WRITE", "config file name is not UTF-8"))?;
    let stamp = utc_stamp();
    let mut candidate = parent.join(format!("{name}.bak-{stamp}"));
    let mut suffix = 1;
    while candidate.exists() {
        candidate = parent.join(format!("{name}.bak-{stamp}-{suffix}"));
        suffix += 1;
    }
    Ok(candidate)
}

fn prune_backups(target: &Path, keep: usize) -> AppResult<()> {
    let mut backups = backup_files(target);
    if backups.len() <= keep {
        return Ok(());
    }
    backups.sort();
    let remove_count = backups.len() - keep;
    for path in backups.into_iter().take(remove_count) {
        fs::remove_file(&path).map_err(|err| {
            AppError::new(
                "CONFIG_WRITE",
                format!("cannot remove old backup {}: {err}", path.display()),
            )
        })?;
    }
    Ok(())
}

fn backup_files(target: &Path) -> Vec<PathBuf> {
    let Some(parent) = target.parent() else {
        return Vec::new();
    };
    let Some(name) = target.file_name().and_then(|value| value.to_str()) else {
        return Vec::new();
    };
    let prefix = format!("{name}.bak-");
    let Ok(entries) = fs::read_dir(parent) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .map(|name| name.starts_with(&prefix))
                .unwrap_or(false)
                && path.is_file()
        })
        .collect()
}

fn utc_stamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = (seconds / 86_400) as i64;
    let remainder = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    let hour = remainder / 3_600;
    let minute = (remainder % 3_600) / 60;
    let second = remainder % 60;
    format!("{year:04}{month:02}{day:02}T{hour:02}{minute:02}{second:02}Z")
}

/// Howard Hinnant's civil-from-days algorithm; avoids a date dependency.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (mp + if mp < 10 { 3 } else { -9 }) as u32;
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_data_dir_resolves_against_config_parent() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("seo.toml");
        let document = parse_toml("[storage]\ndata_dir = \"data\"\n").unwrap();
        assert_eq!(
            data_dir_from_document(&document, &config).unwrap(),
            dir.path().join("data")
        );
    }

    #[test]
    fn absolute_data_dir_is_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("seo.toml");
        let absolute = dir.path().join("elsewhere");
        let document = parse_toml(&format!(
            "[storage]\ndata_dir = {:?}\n",
            absolute.display().to_string()
        ))
        .unwrap();
        assert_eq!(
            data_dir_from_document(&document, &config).unwrap(),
            absolute
        );
    }

    #[test]
    fn invalid_toml_is_a_typed_error() {
        let error = parse_toml("[storage\n").unwrap_err();
        assert_eq!(error.code(), "CONFIG_TOML_INVALID");
    }

    #[test]
    fn atomic_write_replaces_content_and_creates_backups() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("seo.toml");
        write_atomic_unchecked(&target, "version = 1\n").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "version = 1\n");
        assert!(backup_files(&target).is_empty());

        write_atomic_unchecked(&target, "version = 2\n").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "version = 2\n");
        assert_eq!(backup_files(&target).len(), 1);
    }

    #[test]
    fn text_export_is_atomic_and_creates_no_backup() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("report.json");
        let outcome = write_text_atomic(&target, "{\"ok\":true}\n").unwrap();
        assert_eq!(outcome.bytes, 12);
        assert_eq!(fs::read_to_string(&target).unwrap(), "{\"ok\":true}\n");
        assert!(backup_files(&target).is_empty());

        write_text_atomic(&target, "{\"ok\":false}\n").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "{\"ok\":false}\n");
        assert!(backup_files(&target).is_empty());
    }

    #[test]
    fn only_five_backups_are_kept() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("seo.toml");
        for version in 1..=7 {
            write_atomic_unchecked(&target, &format!("version = {version}\n")).unwrap();
        }
        let backups = backup_files(&target);
        assert_eq!(backups.len(), 5);
        assert_eq!(fs::read_to_string(&target).unwrap(), "version = 7\n");

        let mut backups = backups;
        backups.sort();
        let newest = backups.last().unwrap();
        assert_eq!(fs::read_to_string(newest).unwrap(), "version = 6\n");
    }

    #[test]
    fn failed_commit_does_not_leave_the_target_changed() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("seo.toml");
        fs::write(&target, "version = 1\n").unwrap();
        let temp = dir.path().join("missing-temp.toml");
        let error = commit_temp(&temp, &target).unwrap_err();
        assert_eq!(error.code(), "CONFIG_WRITE");
        assert_eq!(fs::read_to_string(&target).unwrap(), "version = 1\n");
    }

    #[test]
    fn partial_temp_files_are_removed_after_a_write_failure() {
        let dir = tempfile::tempdir().unwrap();
        let candidate = dir.path().join("partial.tmp");
        fs::write(&candidate, "").unwrap();
        let read_only = OpenOptions::new().read(true).open(&candidate).unwrap();
        let error = finish_temp(read_only, &candidate, "version = 1\n").unwrap_err();
        assert_eq!(error.code(), "IO");
        assert!(!candidate.exists());
    }

    #[test]
    fn validation_staging_falls_back_to_the_app_config_dir() {
        let dir = tempfile::tempdir().unwrap();
        let missing_parent = dir.path().join("read-only").join("seo.toml");
        let fallback = dir.path().join("app-config");
        fs::create_dir(&fallback).unwrap();

        let temp =
            stage_validation_temp(&missing_parent, "version = 1\n", Some(&fallback)).unwrap();
        assert!(temp.starts_with(&fallback));
        assert_eq!(fs::read_to_string(&temp).unwrap(), "version = 1\n");
        fs::remove_file(&temp).unwrap();
        assert!(!temp.exists());
    }

    #[test]
    fn validation_staging_without_a_fallback_reports_the_original_error() {
        let dir = tempfile::tempdir().unwrap();
        let missing_parent = dir.path().join("missing").join("seo.toml");
        let error = stage_validation_temp(&missing_parent, "version = 1\n", None).unwrap_err();
        assert_eq!(error.code(), "CONFIG_WRITE");
    }

    #[test]
    fn utc_stamp_uses_a_civil_date() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_000), (2024, 10, 4));
        assert!(utc_stamp().ends_with('Z'));
    }

    fn patch(path: &str, value: Value) -> Patch {
        Patch {
            section: None,
            key: None,
            path: Some(path.to_string()),
            value,
        }
    }

    #[test]
    fn patches_preserve_comments_order_and_types() {
        let raw = "# top comment\n[report]\nlocale = \"ru\" # keep locale\n\n[report.email]\nenabled = false\nto = [\"a@example.com\"]\n";
        let mut document = parse_toml(raw).unwrap();
        apply_patches(
            &mut document,
            &[
                patch("report.locale", serde_json::json!("en")),
                patch("report.email.enabled", serde_json::json!(true)),
                patch(
                    "report.email.to",
                    serde_json::json!(["b@example.com", "c@example.com"]),
                ),
                patch(
                    "report.thresholds",
                    serde_json::json!({ "clicks_pct": 10, "position_abs": 1.5 }),
                ),
            ],
        )
        .unwrap();
        let output = document.to_string();
        assert!(output.contains("# top comment"));
        assert!(output.contains("locale = \"en\" # keep locale"));
        assert!(output.contains("enabled = true"));
        assert!(output.contains("\"b@example.com\""));
        assert!(output.contains("clicks_pct = 10"));
    }

    #[test]
    fn section_key_patch_and_null_removal_work() {
        let mut document =
            parse_toml("[report.email]\nenabled = true\nfrom = \"seo@example.com\"\n").unwrap();
        apply_patches(
            &mut document,
            &[Patch {
                section: Some("report.email".into()),
                key: Some("from".into()),
                path: None,
                value: serde_json::json!("ops@example.com"),
            }],
        )
        .unwrap();
        assert!(document.to_string().contains("from = \"ops@example.com\""));

        apply_patches(
            &mut document,
            &[Patch {
                section: Some("report.email".into()),
                key: Some("enabled".into()),
                path: None,
                value: Value::Null,
            }],
        )
        .unwrap();
        assert!(!document.to_string().contains("enabled"));
    }

    #[test]
    fn inline_table_patches_are_supported() {
        let mut document =
            parse_toml("[report]\nthresholds = { clicks_pct = 10, position_abs = 1.5 }\n").unwrap();
        apply_patches(
            &mut document,
            &[
                patch("report.thresholds.clicks_pct", serde_json::json!(12)),
                patch("report.thresholds.position_abs", Value::Null),
            ],
        )
        .unwrap();
        let output = document.to_string();
        assert!(output.contains("clicks_pct = 12"));
        assert!(!output.contains("position_abs"));
    }

    #[test]
    fn invalid_patch_paths_are_rejected() {
        let mut document = parse_toml("[report]\nlocale = \"ru\"\n").unwrap();
        for path in ["", "report..locale", "report.locale[0]", "report.locale "] {
            let error =
                apply_patches(&mut document, &[patch(path, serde_json::json!("en"))]).unwrap_err();
            assert_eq!(error.code(), "CONFIG_PATCH", "{path:?}");
        }
        let error = apply_patches(
            &mut document,
            &[Patch {
                section: None,
                key: None,
                path: None,
                value: serde_json::json!("x"),
            }],
        )
        .unwrap_err();
        assert_eq!(error.code(), "CONFIG_PATCH");
    }
}
