use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};
use serde_json::Value;

/// Typed error returned to the webview.
///
/// Tauri serializes command errors as the command's `Err` value, so this type
/// serializes to `{code, message, details?}`. The webview must branch on
/// `code`, never on a process exit code.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{message}")]
    Coded {
        code: &'static str,
        message: String,
        details: Option<Value>,
    },
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("TOML error: {0}")]
    Toml(#[from] toml_edit::TomlError),
}

impl AppError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self::Coded {
            code,
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        if let Self::Coded { details: slot, .. } = &mut self {
            *slot = Some(details);
        }
        self
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Coded { code, .. } => code,
            Self::Io(_) => "IO",
            Self::Json(_) => "INVALID_JSON",
            Self::Toml(_) => "CONFIG_TOML_INVALID",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::Coded { message, .. } => message.clone(),
            Self::Io(err) => format!("I/O error: {err}"),
            Self::Json(err) => format!("JSON error: {err}"),
            Self::Toml(err) => format!("TOML error: {err}"),
        }
    }

    pub fn details(&self) -> Option<Value> {
        match self {
            Self::Coded { details, .. } => details.clone(),
            _ => None,
        }
    }

    pub fn info(&self) -> ErrorInfo {
        ErrorInfo {
            code: self.code().to_string(),
            message: self.message(),
            details: self.details(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorInfo {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 3)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.message())?;
        match self.details() {
            Some(details) => state.serialize_field("details", &details)?,
            None => state.serialize_field("details", &Value::Null)?,
        }
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coded_error_serializes_with_code_and_message() {
        let error =
            AppError::new("ENGINE_NOT_FOUND", "no engine").with_details(serde_json::json!({
                "candidates": ["a", "b"]
            }));
        let value = serde_json::to_value(&error).unwrap();
        assert_eq!(value["code"], "ENGINE_NOT_FOUND");
        assert_eq!(value["message"], "no engine");
        assert_eq!(value["details"]["candidates"][1], "b");
    }

    #[test]
    fn io_error_has_stable_code() {
        let error = AppError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, "missing"));
        assert_eq!(error.code(), "IO");
        assert!(error.message().contains("missing"));
    }
}
