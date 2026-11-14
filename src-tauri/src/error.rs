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

/// Key fragments that mark a value as a credential. It extends the webview's
/// `redactToml` list so the shell and the UI agree on what a secret looks like.
const SECRET_KEY_MARKERS: &[&str] = &[
    "token",
    "secret",
    "password",
    "passwd",
    "api_key",
    "apikey",
    "api-key",
    "authorization",
    "bearer",
    "cookie",
    "credential",
    "private_key",
    "privatekey",
    "access_key",
];

/// Header-style keys whose value runs to the end of the line
/// (`Authorization: Bearer <token>` must not leave the token behind).
const HEADER_KEY_MARKERS: &[&str] = &["authorization", "cookie"];

/// Mask credential-looking assignments in free text before it reaches the
/// webview or the log.
///
/// The engine's `stderr` and tracebacks can quote a `seo.toml` line or an argv
/// verbatim, so `token = "..."`, `"apiKey": "..."`, `Authorization: Bearer ...`
/// and `--token ...` are rewritten to `***`. Everything else (paths, URLs,
/// engine messages) is preserved so diagnostics stay useful.
pub fn redact_secrets(text: &str) -> String {
    text.split('\n')
        .map(redact_line)
        .collect::<Vec<_>>()
        .join("\n")
}

fn redact_line(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut index = 0;
    while index < chars.len() {
        let ch = chars[index];
        if ch == '=' || ch == ':' {
            let key = key_before(&chars, index);
            if !key.is_empty() && is_secret_key(&key) {
                out.push(ch);
                index = mask_value(&chars, index + 1, &mut out, is_header_key(&key));
                continue;
            }
        }
        if ch == '-' && chars.get(index + 1) == Some(&'-') {
            let start = index + 2;
            let mut end = start;
            while end < chars.len() && is_key_char(chars[end]) {
                end += 1;
            }
            let name: String = chars[start..end].iter().collect();
            if !name.is_empty() && is_secret_key(&name) {
                out.extend(chars[index..end].iter().copied());
                index = end;
                let mut spaces = index;
                while spaces < chars.len() && chars[spaces] == ' ' {
                    spaces += 1;
                }
                if spaces > index && spaces < chars.len() && chars[spaces] != '-' {
                    out.push(' ');
                    index = mask_value(&chars, spaces, &mut out, false);
                }
                continue;
            }
        }
        out.push(ch);
        index += 1;
    }
    out
}

/// The key that precedes a `=`/`:` separator: the trailing run of key
/// characters, unquoted, last dotted segment only (`auth.token` -> `token`).
fn key_before(chars: &[char], separator: usize) -> String {
    let mut end = separator;
    while end > 0 && chars[end - 1] == ' ' {
        end -= 1;
    }
    if end > 0 && (chars[end - 1] == '"' || chars[end - 1] == '\'') {
        // `{"apiKey": "..."}` and `'token': '...'`: read the quoted key.
        let quote = chars[end - 1];
        let mut start = end - 1;
        while start > 0 && chars[start - 1] != quote {
            start -= 1;
        }
        let raw: String = chars[start..end - 1].iter().collect();
        return raw
            .rsplit('.')
            .next()
            .unwrap_or(raw.as_str())
            .to_ascii_lowercase();
    }
    let mut start = end;
    while start > 0 && is_key_char(chars[start - 1]) {
        start -= 1;
    }
    let raw: String = chars[start..end].iter().collect();
    let raw = raw.rsplit('.').next().unwrap_or(raw.as_str());
    raw.to_ascii_lowercase()
}

fn is_key_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.')
}

fn is_secret_key(key: &str) -> bool {
    SECRET_KEY_MARKERS.iter().any(|marker| key.contains(marker))
}

fn is_header_key(key: &str) -> bool {
    HEADER_KEY_MARKERS.iter().any(|marker| key.contains(marker))
}

/// Replace one value starting at `index` with `***`, keeping surrounding
/// quotes. Returns the index just past the masked value.
fn mask_value(chars: &[char], index: usize, out: &mut String, to_end_of_line: bool) -> usize {
    let mut cursor = index;
    while cursor < chars.len() && chars[cursor] == ' ' {
        // Keep the spacing between the key and its separator readable.
        out.push(' ');
        cursor += 1;
    }
    if cursor >= chars.len() {
        return cursor;
    }
    let quote = chars[cursor];
    if quote == '"' || quote == '\'' {
        out.push(quote);
        out.push_str("***");
        let mut scan = cursor + 1;
        while scan < chars.len() {
            if chars[scan] == '\\' && quote == '"' {
                scan += 2;
                continue;
            }
            if chars[scan] == quote {
                out.push(quote);
                return scan + 1;
            }
            scan += 1;
        }
        return chars.len();
    }
    let mut scan = cursor;
    if to_end_of_line {
        // `Authorization: Bearer <token>`: the credential is the rest of the
        // line, not just the first word.
        out.push_str("***");
        return chars.len();
    }
    while scan < chars.len() {
        let ch = chars[scan];
        if matches!(ch, ',' | ';' | ')' | ']' | '}') || ch.is_whitespace() {
            break;
        }
        scan += 1;
    }
    out.push_str("***");
    scan
}

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

    #[test]
    fn redaction_masks_toml_and_json_credentials() {
        let raw = "[auth]\ntoken = \"sk-live-123\"\nreport.email.password = 'hunter2'\n";
        let redacted = redact_secrets(raw);
        assert!(!redacted.contains("sk-live-123"), "{redacted}");
        assert!(!redacted.contains("hunter2"), "{redacted}");
        assert!(redacted.contains("token = \"***\""), "{redacted}");
        assert!(redacted.contains("password = '***'"), "{redacted}");
        assert!(redacted.contains("[auth]"), "{redacted}");

        let json = redact_secrets(r#"{"apiKey": "abc123", "uiLocale": "ru"}"#);
        assert!(!json.contains("abc123"), "{json}");
        assert!(json.contains("\"apiKey\": \"***\""), "{json}");
        assert!(json.contains("\"uiLocale\": \"ru\""), "{json}");
    }

    #[test]
    fn redaction_masks_authorization_headers_and_cli_flags() {
        let header = redact_secrets("Authorization: Bearer eyJhbGciOi.payload.sig\nnext line");
        assert!(!header.contains("eyJhbGciOi"), "{header}");
        assert!(header.starts_with("Authorization: ***"), "{header}");
        assert!(header.ends_with("\nnext line"), "{header}");

        let flag = redact_secrets("lv24-seo auth set --provider gsc --token ya29.secret --json");
        assert!(!flag.contains("ya29.secret"), "{flag}");
        assert!(flag.contains("--token ***"), "{flag}");
        assert!(flag.contains("--provider gsc"), "{flag}");

        let equals = redact_secrets("lv24-seo auth set --token=ya29.secret");
        assert!(!equals.contains("ya29.secret"), "{equals}");
    }

    #[test]
    fn redaction_keeps_ordinary_paths_and_urls_readable() {
        for text in [
            r"cannot read config C:\projects\seo\seo.toml: not found",
            "https://api.example.com/v1/sites?site=x",
            "token.py failed at line 3",
            "report.locale must be one of en, ru, zh",
        ] {
            assert_eq!(redact_secrets(text), text, "{text}");
        }
    }

    #[test]
    fn redaction_preserves_line_endings_and_empty_input() {
        assert_eq!(redact_secrets(""), "");
        assert_eq!(redact_secrets("\n"), "\n");
        let crlf = redact_secrets("token = \"abc\"\r\nok = 1\r\n");
        assert_eq!(crlf, "token = \"***\"\r\nok = 1\r\n");
    }
}
