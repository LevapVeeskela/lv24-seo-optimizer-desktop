use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use toml_edit::{DocumentMut, Item, Table, TableLike, Value as TomlValue};

use crate::cli::{self, CliArgs, CliCommandId};
use crate::error::{redact_secrets, AppError, AppResult};
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
    let metadata = fs::metadata(path).map_err(|err| {
        AppError::new(
            "CONFIG_READ",
            format!("cannot read config {}: {err}", path.display()),
        )
    })?;
    if !metadata.is_file() {
        // A FIFO or device would block or read forever; a directory has no
        // TOML to show. Both are reported instead of attempted.
        return Err(AppError::new(
            "CONFIG_READ",
            format!("config {} is not a regular file", path.display()),
        ));
    }
    if metadata.len() > MAX_CONFIG_BYTES {
        return Err(config_too_large(path));
    }
    let file = File::open(path).map_err(|err| {
        AppError::new(
            "CONFIG_READ",
            format!("cannot read config {}: {err}", path.display()),
        )
    })?;
    // Bound the read as well: the file can grow between `metadata` and the
    // read, and a symlink can point at something much larger than it looked.
    let mut buffer = Vec::new();
    file.take(MAX_CONFIG_BYTES + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| {
            AppError::new(
                "CONFIG_READ",
                format!("cannot read config {}: {err}", path.display()),
            )
        })?;
    if buffer.len() as u64 > MAX_CONFIG_BYTES {
        return Err(config_too_large(path));
    }
    String::from_utf8(buffer).map_err(|_| {
        AppError::new(
            "CONFIG_READ",
            format!("config {} is not valid UTF-8", path.display()),
        )
    })
}

fn config_too_large(path: &Path) -> AppError {
    AppError::new(
        "CONFIG_READ",
        format!(
            "config {} is larger than {} bytes",
            path.display(),
            MAX_CONFIG_BYTES
        ),
    )
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
    resolve_data_dir_with_home(raw, config_path, home_dir().as_deref())
}

fn resolve_data_dir_with_home(raw: &str, config_path: &Path, home: Option<&Path>) -> PathBuf {
    let trimmed = raw.trim();
    if let Some(home) = home {
        if trimmed == "~" {
            return home.to_path_buf();
        }
        if let Some(rest) = trimmed
            .strip_prefix("~/")
            .or_else(|| trimmed.strip_prefix("~\\"))
        {
            return home.join(rest);
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

/// `HOME`/`USERPROFILE`, but only when it is a usable absolute directory. An
/// empty or relative value must not silently turn `~/data` into a path relative
/// to the desktop's cwd.
fn home_dir() -> Option<PathBuf> {
    ["HOME", "USERPROFILE"].iter().find_map(|name| {
        let value = std::env::var_os(name)?;
        if value.is_empty() {
            return None;
        }
        let path = PathBuf::from(value);
        path.is_absolute().then_some(path)
    })
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
        match create_private_file(&candidate) {
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

/// Create a new file that only the current user can read. A config draft can
/// hold a token that the user pasted before validation rejects it, and the
/// process umask must not make that draft world-readable.
fn create_private_file(candidate: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(candidate)
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
        return Err(AppError::new(
            "IO",
            format!("cannot write {}: {err}", candidate.display()),
        ));
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
            // The backup is the recovery point, so it must reach the disk
            // before the original is replaced. It also inherits the restrictive
            // permissions documented for backups instead of the source mode.
            sync_backup(&backup_path);
            restrict_backup(&backup_path);
            prune_backups(target, BACKUP_KEEP);
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
    sync_parent(target);
    let bytes = fs::metadata(target)
        .map(|meta| meta.len() as usize)
        .unwrap_or(0);
    Ok(WriteOutcome {
        path: target.display().to_string(),
        backup: backup.map(|path| path.display().to_string()),
        bytes,
    })
}

/// Reopen the copied backup and flush it. A crash after the rename must not
/// leave a zero-length or truncated recovery point.
fn sync_backup(path: &Path) {
    match OpenOptions::new().write(true).open(path) {
        Ok(file) => {
            if let Err(err) = file.sync_all() {
                log::warn!("cannot fsync config backup {}: {err}", path.display());
            }
        }
        Err(err) => log::warn!(
            "cannot reopen config backup {} to fsync it: {err}",
            path.display()
        ),
    }
}

/// Backups stay readable only by the owner on Unix. Best effort: a filesystem
/// that rejects the mode must not block saving the user's configuration.
fn restrict_backup(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(err) = fs::set_permissions(path, fs::Permissions::from_mode(0o600)) {
            log::warn!(
                "cannot restrict config backup permissions on {}: {err}",
                path.display()
            );
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

/// Flush the directory entry so a rename survives a power loss. The file
/// contents were already fsynced before the rename.
fn sync_parent(target: &Path) {
    #[cfg(unix)]
    {
        if let Some(parent) = target.parent() {
            match File::open(parent) {
                Ok(dir) => {
                    if let Err(err) = dir.sync_all() {
                        log::warn!("cannot fsync {}: {err}", parent.display());
                    }
                }
                Err(err) => log::warn!("cannot open {} to fsync it: {err}", parent.display()),
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = target;
    }
}

/// Install a staged temp file over `target`: keep the previous file mode, swap
/// atomically and flush the directory entry.
pub(crate) fn install_temp(temp: &Path, target: &Path) -> AppResult<()> {
    if let Ok(metadata) = fs::metadata(target) {
        if metadata.is_file() {
            if let Err(err) = fs::set_permissions(temp, metadata.permissions()) {
                log::warn!(
                    "cannot preserve permissions of {} on {}: {err}",
                    target.display(),
                    temp.display()
                );
            }
        }
    }
    atomic_replace(temp, target)?;
    sync_parent(target);
    Ok(())
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
    match install_temp(&temp, target) {
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
        // The engine can quote a config line or an argv in a traceback; the
        // webview must never receive a credential through `stderr`.
        stderr: redact_secrets(&result.stderr),
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

/// Replace `target` with `temp`, refusing a directory target.
///
/// A symlink target is replaced, never followed: the rename acts on the
/// directory entry, so a link inside an allow-listed directory cannot redirect
/// the write to a file outside it. The link's own target keeps its content and
/// the caller's backup holds the previous bytes.
pub(crate) fn atomic_replace(temp: &Path, target: &Path) -> AppResult<()> {
    // A directory must never be moved aside by the Windows fallback below; the
    // caller would lose a whole tree for a mistyped config path.
    if let Ok(metadata) = fs::symlink_metadata(target) {
        if metadata.is_dir() {
            return Err(AppError::new(
                "CONFIG_WRITE",
                format!("target is a directory: {}", target.display()),
            ));
        }
    }
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
                if fs::symlink_metadata(target).is_ok() {
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
                            // The new file is installed; failing to delete the
                            // old copy is debris, not a failed write, but the
                            // path must be visible in the log.
                            if let Err(err) = fs::remove_file(&old) {
                                log::warn!(
                                    "config was replaced but the previous copy at {} could not be \
                                     removed: {err}",
                                    old.display()
                                );
                            }
                            Ok(())
                        }
                        Err(second) => match fs::rename(&old, target) {
                            Ok(()) => Err(AppError::new(
                                "CONFIG_WRITE",
                                format!(
                                    "cannot replace {}: {second} (restored the previous file)",
                                    target.display()
                                ),
                            )),
                            // Never claim a restoration that did not happen: the
                            // previous file is still at `old` and the caller (and
                            // the user) must be told exactly where it is.
                            Err(restore) => Err(restore_failure(&old, target, &second, &restore)),
                        },
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

/// A failed Windows fallback could not put the previous file back. Report the
/// replacement error, the restore error and the exact `.old` path; the caller
/// must never treat this as a successful rollback.
#[cfg_attr(not(windows), allow(dead_code))]
fn restore_failure(
    old: &Path,
    target: &Path,
    replace: &std::io::Error,
    restore: &std::io::Error,
) -> AppError {
    AppError::new(
        "CONFIG_WRITE",
        format!(
            "cannot replace {}: {replace}; restoring the previous file failed ({restore}); \
             the previous file is kept at {}",
            target.display(),
            old.display()
        ),
    )
    .with_details(serde_json::json!({
        "path": target.display().to_string(),
        "oldPath": old.display().to_string(),
        "restoreError": restore.to_string(),
    }))
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

fn prune_backups(target: &Path, keep: usize) {
    let mut backups = backup_files(target);
    if backups.len() <= keep {
        return;
    }
    backups.sort();
    let remove_count = backups.len() - keep;
    for path in backups.into_iter().take(remove_count) {
        // Retention is housekeeping: an old backup that cannot be deleted must
        // not block saving the new configuration.
        if let Err(err) = fs::remove_file(&path) {
            log::warn!("cannot remove old config backup {}: {err}", path.display());
        }
    }
}

fn backup_files(target: &Path) -> Vec<PathBuf> {
    let Some(parent) = target.parent() else {
        return Vec::new();
    };
    let Some(name) = target.file_name().and_then(|value| value.to_str()) else {
        return Vec::new();
    };
    let prefix = format!("{name}.bak-");
    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(err) => {
            // Retention and the reported backup list silently lose entries if
            // the directory cannot be listed; say so instead of pretending
            // there are no backups.
            log::warn!(
                "cannot list {} to find config backups: {err}",
                parent.display()
            );
            return Vec::new();
        }
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
    fn failed_restore_reports_the_old_path_instead_of_claiming_success() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("seo.toml");
        let old = dir.path().join(".seo.toml.old-1-1");
        let replace = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "locked");
        let restore = std::io::Error::new(std::io::ErrorKind::NotFound, "gone");

        let error = restore_failure(&old, &target, &replace, &restore);

        assert_eq!(error.code(), "CONFIG_WRITE");
        assert!(!error.message().contains("restored the previous file"));
        assert!(error.message().contains(&old.display().to_string()));
        let details = error.details().unwrap();
        assert_eq!(details["oldPath"], old.display().to_string());
        assert_eq!(details["restoreError"], "gone");
    }

    #[test]
    fn partial_temp_files_are_removed_after_a_write_failure() {
        let dir = tempfile::tempdir().unwrap();
        let candidate = dir.path().join("partial.tmp");
        fs::write(&candidate, "").unwrap();
        let read_only = OpenOptions::new().read(true).open(&candidate).unwrap();
        let error = finish_temp(read_only, &candidate, "version = 1\n").unwrap_err();
        assert_eq!(error.code(), "IO");
        assert!(error.message().contains(&candidate.display().to_string()));
        assert!(!candidate.exists());
    }

    #[test]
    fn reads_are_bounded_and_reject_non_files() {
        let dir = tempfile::tempdir().unwrap();
        let oversized = dir.path().join("big.toml");
        fs::write(&oversized, vec![b'x'; MAX_CONFIG_BYTES as usize + 1]).unwrap();
        let error = read_raw(&oversized).unwrap_err();
        assert_eq!(error.code(), "CONFIG_READ");
        assert!(error.message().contains("larger than"));

        let error = read_raw(dir.path()).unwrap_err();
        assert_eq!(error.code(), "CONFIG_READ");
        assert!(error.message().contains("not a regular file"));

        let binary = dir.path().join("binary.toml");
        fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
        let error = read_raw(&binary).unwrap_err();
        assert_eq!(error.code(), "CONFIG_READ");
        assert!(error.message().contains("not valid UTF-8"));

        let missing = dir.path().join("missing.toml");
        assert_eq!(read_raw(&missing).unwrap_err().code(), "CONFIG_READ");
    }

    #[test]
    fn data_dir_expands_home_only_for_a_usable_home() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("seo.toml");
        let home = dir.path().join("home");

        assert_eq!(resolve_data_dir_with_home("~", &config, Some(&home)), home);
        assert_eq!(
            resolve_data_dir_with_home("~/data", &config, Some(&home)),
            home.join("data")
        );
        assert_eq!(
            resolve_data_dir_with_home("~\\data", &config, Some(&home)),
            home.join("data")
        );
        // A bare `~user` is not a home reference; it stays a relative path.
        assert_eq!(
            resolve_data_dir_with_home("~other/data", &config, Some(&home)),
            dir.path().join("~other").join("data")
        );
        // Without a home directory the value must not become absolute by
        // accident; it resolves next to the config like any relative path.
        assert_eq!(
            resolve_data_dir_with_home("~/data", &config, None),
            dir.path().join("~").join("data")
        );
        let absolute = dir.path().join("elsewhere");
        assert_eq!(
            resolve_data_dir_with_home(&absolute.display().to_string(), &config, Some(&home)),
            absolute
        );
    }

    #[test]
    fn staged_config_files_are_private_on_unix() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("seo.toml");
        let temp = stage_temp(&target, "version = 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&temp).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "temp config mode was {mode:o}");
        }
        fs::remove_file(&temp).unwrap();
    }

    #[test]
    fn config_writes_keep_the_existing_file_mode() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("seo.toml");
        fs::write(&target, "version = 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();
        }
        write_atomic_unchecked(&target, "version = 2\n").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "version = 2\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o640, "config mode was {mode:o}");
        }
    }

    #[test]
    fn backups_are_restricted_on_unix() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("seo.toml");
        fs::write(&target, "version = 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&target, fs::Permissions::from_mode(0o644)).unwrap();
        }
        write_atomic_unchecked(&target, "version = 2\n").unwrap();
        let backups = backup_files(&target);
        assert_eq!(backups.len(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&backups[0]).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "backup mode was {mode:o}");
        }
        assert_eq!(fs::read_to_string(&backups[0]).unwrap(), "version = 1\n");
    }

    #[test]
    fn replacing_a_directory_is_refused_instead_of_moving_it() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("seo.toml");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep.txt"), "keep").unwrap();
        let temp = stage_temp(&dir.path().join("other.toml"), "version = 1\n").unwrap();

        let error = atomic_replace(&temp, &target).unwrap_err();
        assert_eq!(error.code(), "CONFIG_WRITE");
        assert!(target.is_dir());
        assert_eq!(fs::read_to_string(target.join("keep.txt")).unwrap(), "keep");
        fs::remove_file(&temp).unwrap();
    }

    #[test]
    fn a_failed_install_keeps_the_previous_export() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("report.json");
        fs::write(&target, "{\"ok\":true}\n").unwrap();
        let temp = dir.path().join("missing.tmp");
        assert!(install_temp(&temp, &target).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "{\"ok\":true}\n");
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
