import {
  isReservedPath,
  type ConfigDiffEntry,
  type ConfigModel,
  type ConfigPatch,
} from "@/entities/config/model/types";
import { flattenConfig } from "@/entities/config/lib/model";

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Field-level diff between the saved file model and the draft. Provider block
 * presence is included so adding an empty block is visible before saving.
 */
export function diffConfigs(
  saved: ConfigModel,
  draft: ConfigModel,
): ConfigDiffEntry[] {
  const savedFlat = flattenConfig(saved);
  const draftFlat = flattenConfig(draft);
  const paths = new Set([
    ...Object.keys(savedFlat),
    ...Object.keys(draftFlat),
  ]);
  const entries: ConfigDiffEntry[] = [];
  for (const path of paths) {
    const before = savedFlat[path];
    const after = draftFlat[path];
    if (equal(before, after)) {
      continue;
    }
    entries.push({
      path,
      saved: before,
      draft: after,
      reserved: isReservedPath(path),
      kind: path.endsWith(".present") ? "presence" : "value",
    });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Convert a field-level diff into `config_patch` operations. Provider block
 * presence is a UI-only field (`providers.gsc.present`); turning a block off
 * removes the whole table, and turning it on relies on the field patches that
 * the form emits. A presence-only change (the user re-set a value that already
 * matched the default) has no field patch, so the draft's leaf values are
 * written explicitly instead of reporting a false success. Leaf removals use
 * `null`.
 */
export function diffToPatches(
  entries: ConfigDiffEntry[],
  draft?: ConfigModel | null,
): ConfigPatch[] {
  const removedSections = new Set(
    entries
      .filter((entry) => entry.kind === "presence" && entry.draft !== true)
      .map((entry) => entry.path.replace(/\.present$/, "")),
  );
  const patches: ConfigPatch[] = [];
  for (const entry of entries) {
    if (entry.kind === "presence") {
      const section = entry.path.replace(/\.present$/, "");
      if (entry.draft !== true) {
        patches.push({ path: section, value: null });
      } else if (draft && !hasFieldChange(entries, section)) {
        patches.push(...sectionLeafPatches(draft, section));
      }
      continue;
    }
    if (
      [...removedSections].some(
        (section) =>
          entry.path === section || entry.path.startsWith(`${section}.`),
      )
    ) {
      continue;
    }
    patches.push({
      path: entry.path,
      value: entry.draft === undefined ? null : entry.draft,
    });
  }
  return patches;
}

function hasFieldChange(entries: ConfigDiffEntry[], section: string): boolean {
  return entries.some(
    (entry) =>
      entry.kind !== "presence" && entry.path.startsWith(`${section}.`),
  );
}

function sectionLeafPatches(
  draft: ConfigModel,
  section: string,
): ConfigPatch[] {
  return Object.entries(flattenConfig(draft))
    .filter(
      ([path]) =>
        path.startsWith(`${section}.`) && !path.endsWith(".present"),
    )
    .map(([path, value]) => ({ path, value }));
}

export function formatDiffValue(value: unknown): string {
  if (value === undefined) {
    return "—";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return value.length ? value.map(formatDiffValue).join(", ") : "[]";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return value.trim() ? value : "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
