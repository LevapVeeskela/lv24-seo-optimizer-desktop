/**
 * Evidence payloads are displayed verbatim except for credential-shaped keys.
 * The engine already rejects such keys on add, but an old row or a hand-edited
 * store must never turn the task card into a secret viewer.
 */

// Same shape as the engine's `_SECRET_KEY_RE`: the credential noun must be the
// final word, so `tokens` or `token_count` stay ordinary evidence.
const SECRET_KEY_RE =
  /(?:^|[_-])(token|secret|password|api[_-]?key|authorization)$/i;

const REDACTED = "[redacted]";
const MAX_DEPTH = 20;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

interface PendingValue {
  value: unknown;
  path: string;
}

/**
 * First credential-shaped key path, or `null` when the payload is safe.
 * Iterative on purpose: a parsed 16 KiB payload can be deep enough to make a
 * naive recursive walk overflow before it finds the secret.
 */
export function findSecretPath(value: unknown): string | null {
  const queue: PendingValue[] = [{ value, path: "payload" }];
  let index = 0;
  while (index < queue.length) {
    const current = queue[index];
    index += 1;
    if (Array.isArray(current.value)) {
      current.value.forEach((item, itemIndex) => {
        queue.push({
          value: item,
          path: `${current.path}[${itemIndex}]`,
        });
      });
      continue;
    }
    if (typeof current.value !== "object" || current.value === null) {
      continue;
    }
    for (const [key, item] of Object.entries(current.value)) {
      if (isSecretKey(key)) {
        return `${current.path}.${key}`;
      }
      queue.push({ value: item, path: `${current.path}.${key}` });
    }
  }
  return null;
}

/** Copy a payload with every credential-shaped value replaced. */
export function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactPayload(item, depth + 1));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = isSecretKey(key)
      ? REDACTED
      : redactPayload(item, depth + 1);
  }
  return result;
}

/** Pretty, redacted JSON for the evidence disclosure. */
export function formatPayload(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(redactPayload(payload), null, 2) ?? "{}";
  } catch {
    return "{}";
  }
}

/** Show a URL without embedded credentials; relative paths stay unchanged. */
export function displayUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      return url.href;
    }
    return value;
  } catch {
    return value;
  }
}
