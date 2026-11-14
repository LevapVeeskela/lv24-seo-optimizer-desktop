const SECRET_KEY_RE = /token|secret|password|api[_-]?key|authorization/i;

/**
 * Redact secret-looking assignments before showing or copying source TOML.
 * Secrets do not belong in `seo.toml`, but a mistaken value must never reach
 * the screen or the clipboard.
 */
export function redactToml(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const commentAt = findComment(line);
      const code = commentAt >= 0 ? line.slice(0, commentAt) : line;
      const comment = commentAt >= 0 ? line.slice(commentAt) : "";
      const equals = code.indexOf("=");
      if (equals < 0) {
        return redactAssignments(line);
      }
      const key = code.slice(0, equals).trim().replace(/^["']|["']$/g, "");
      const last = key.split(".").pop() ?? key;
      const redacted = SECRET_KEY_RE.test(last)
        ? `${code.slice(0, equals).trimEnd()} = "***"`
        : redactAssignments(code);
      return comment
        ? `${redacted} ${redactAssignments(comment)}`
        : redacted;
    })
    .join("\n");
}

function redactAssignments(text: string): string {
  return text.replace(
    /([A-Za-z0-9_.-]*(?:token|secret|password|api[_-]?key|authorization)[A-Za-z0-9_.-]*\s*=\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi,
    '$1"***"',
  );
}

function findComment(line: string): number {
  let basic = false;
  let literal = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (basic) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        basic = false;
      }
      continue;
    }
    if (literal) {
      if (char === "'") {
        literal = false;
      }
      continue;
    }
    if (char === '"') {
      basic = true;
    } else if (char === "'") {
      literal = true;
    } else if (char === "#") {
      return index;
    }
  }
  return -1;
}
