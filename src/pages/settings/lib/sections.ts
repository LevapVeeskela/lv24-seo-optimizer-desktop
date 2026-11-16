import type { ConfigDiffEntry } from "@/entities/config/model/types";
import type { MessageKey } from "@/shared/i18n";

/**
 * Settings form sections in render order. `prefixes` are the diff-path
 * prefixes each section owns; the section navigation and the changed-only
 * filter both read the same list, so a new field cannot drift out of sync with
 * the navigation.
 */
export interface SettingsSection {
  id: string;
  labelKey: MessageKey;
  prefixes: readonly string[];
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "settings-section-project",
    labelKey: "settings.sections.project",
    prefixes: ["project.", "storage."],
  },
  {
    id: "settings-section-providers",
    labelKey: "settings.sections.providers",
    prefixes: ["providers."],
  },
  {
    id: "settings-section-report",
    labelKey: "settings.sections.report",
    prefixes: [
      "report.locale",
      "report.timezone",
      "report.thresholds.",
      "report.week_start",
    ],
  },
  {
    id: "settings-section-email",
    labelKey: "settings.sections.email",
    prefixes: ["report.email."],
  },
  {
    id: "settings-section-telegram",
    labelKey: "settings.sections.telegram",
    prefixes: ["report.telegram."],
  },
  {
    id: "settings-section-crawl",
    labelKey: "settings.sections.crawl",
    prefixes: ["crawl."],
  },
];

function matchesPrefix(path: string, prefix: string): boolean {
  if (path === prefix) {
    return true;
  }
  const base = prefix.endsWith(".") ? prefix : `${prefix}.`;
  return path.startsWith(base);
}

export function changedPaths(
  diff: readonly ConfigDiffEntry[],
): ReadonlySet<string> {
  return new Set(diff.map((entry) => entry.path));
}

export function sectionChangedPaths(
  section: SettingsSection,
  changed: ReadonlySet<string>,
): string[] {
  return [...changed].filter((path) =>
    section.prefixes.some((prefix) => matchesPrefix(path, prefix)),
  );
}

export function sectionHasChanges(
  section: SettingsSection,
  changed: ReadonlySet<string>,
): boolean {
  return sectionChangedPaths(section, changed).length > 0;
}

/** Changed-only mode keeps fields whose own path changed. */
export function isFieldVisible(
  changedOnly: boolean,
  path: string,
  changed: ReadonlySet<string>,
): boolean {
  return !changedOnly || changed.has(path);
}

export interface FocusableSection {
  scrollIntoView?(options?: {
    behavior?: "auto" | "smooth";
    block?: "start" | "center";
  }): void;
  focus?(options?: { preventScroll?: boolean }): void;
}

export interface SectionDocument {
  getElementById(id: string): FocusableSection | null;
}

/**
 * Scroll to a section and move focus to it, so keyboard users land where the
 * navigation promised. Returns `false` when the section is not rendered (for
 * example it was filtered out).
 */
export function jumpToSection(
  id: string,
  doc: SectionDocument | null,
): boolean {
  const target = doc?.getElementById(id) ?? null;
  if (!target) {
    return false;
  }
  target.scrollIntoView?.({ behavior: "smooth", block: "start" });
  target.focus?.({ preventScroll: true });
  return true;
}
