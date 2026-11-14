/** Lifecycle of the desktop updater, mirrored by the Settings panel. */
export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error"
  /** The release exists but has no artifact for this platform (404/target). */
  | "unsupported";

/** How an updater failure should be presented and retried. */
export type UpdateErrorKind =
  | "offline"
  | "unsupported"
  | "security"
  | "generic";

/** An update announced by the signed release endpoint. */
export interface AvailableUpdate {
  version: string;
  /** RFC 3339 publish date from the manifest, when present. */
  date: string | null;
  /** Release notes from the manifest, when present. */
  notes: string | null;
}
