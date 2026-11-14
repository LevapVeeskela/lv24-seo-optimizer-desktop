import { errorMessage } from "@/shared/lib/errors";
import type { UpdateErrorKind } from "../model/types";

/** Public release page used when in-app installation is impossible. */
export const UPDATE_RELEASE_URL =
  "https://github.com/LevapVeeskela/lv24-seo-optimizer-desktop/releases/latest";

// A bad signature is never retried: the artifact must be replaced, not retried.
const SECURITY_PATTERNS = [
  /signature/i,
  /minisign/i,
  /signed for version/i,
  /requireSignedVersion/i,
  /base64/i,
];

// 404 and missing platform entries mean "no build for this machine", not a bug.
const UNSUPPORTED_PATTERNS = [
  /TargetNotFound/i,
  /TargetsNotFound/i,
  /platform .*was not found/i,
  /fallback platforms/i,
  /platforms.*object/i,
  /Could not fetch a valid release JSON/i,
  /404/i,
  /not found/i,
];

const OFFLINE_PATTERNS = [
  /network/i,
  /offline/i,
  /timed? ?out/i,
  /timeout/i,
  /connection/i,
  /failed to fetch/i,
  /dns/i,
  /reqwest/i,
  /tcp/i,
  /certificate/i,
  /proxy/i,
];

function matches(patterns: RegExp[], message: string): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

/**
 * The updater crosses the Rust/JS boundary as a string, so classification is
 * message-based. Order matters: security wins over "not found", and a failed
 * fetch of the manifest is treated as unsupported rather than as offline.
 */
export function classifyUpdateError(error: unknown): UpdateErrorKind {
  const message = errorMessage(error);
  if (matches(SECURITY_PATTERNS, message)) {
    return "security";
  }
  if (matches(UNSUPPORTED_PATTERNS, message)) {
    return "unsupported";
  }
  if (matches(OFFLINE_PATTERNS, message)) {
    return "offline";
  }
  return "generic";
}
