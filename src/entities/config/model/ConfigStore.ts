import { makeAutoObservable } from "mobx";
import { toAppError, type AppError } from "@/shared/lib/errors";
import {
  configPatch,
  configRead,
  configValidate,
  configWrite,
  runDoctor,
} from "@/entities/config/api/configApi";
import { diffConfigs, diffToPatches } from "@/entities/config/lib/diff";
import { configsEqual, setConfigValue } from "@/entities/config/lib/model";
import { parseConfigToml, serializeConfig } from "@/entities/config/lib/toml";
import { validateConfig } from "@/entities/config/lib/validate";
import {
  cloneConfig,
  type ConfigDiffEntry,
  type ConfigModel,
  type ConfigValidation,
  type DoctorRun,
  type ValidationIssue,
} from "@/entities/config/model/types";

export type ConfigState = "idle" | "loading" | "ready" | "error";

/**
 * Tri-state validation result. `skipped` means no answer was produced for the
 * current draft (a call is already running, the workspace switched, or the user
 * kept typing) — the caller must not turn that into an "invalid" message.
 */
export type ValidationOutcome = "valid" | "invalid" | "skipped";

const KNOWN_ROOTS = new Set([
  "project",
  "providers",
  "report",
  "crawl",
  "storage",
]);

export class ConfigStore {
  state: ConfigState = "idle";
  path: string | null = null;
  raw = "";
  saved: ConfigModel | null = null;
  draft: ConfigModel | null = null;
  effective: Record<string, unknown> | null = null;
  effectivePath: string | null = null;
  resolvedPath: string | null = null;
  dataDir: string | null = null;
  syntaxError: string | null = null;
  warnings: string[] = [];
  parseWarnings: string[] = [];
  unknownKeys: string[] = [];
  engineError: AppError | null = null;
  loadError: AppError | null = null;
  validation: ConfigValidation | null = null;
  validating = false;
  saving = false;
  saveError: AppError | null = null;
  usedFullWrite = false;
  lastBackup: string | null = null;
  backups: string[] = [];
  lastLoadedAt: string | null = null;
  lastValidatedAt: string | null = null;
  doctor: DoctorRun | null = null;
  doctorLoading = false;
  private generation = 0;
  /** Bumped on every draft mutation so in-flight work can detect edits. */
  private revision = 0;

  constructor() {
    makeAutoObservable<ConfigStore, "generation" | "revision">(
      this,
      { generation: false, revision: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get ready(): boolean {
    return this.state === "ready" && this.draft !== null;
  }

  get dirty(): boolean {
    return !configsEqual(this.saved, this.draft);
  }

  get canSave(): boolean {
    return this.ready && this.dirty && !this.saving && !this.validating;
  }

  get diff(): ConfigDiffEntry[] {
    return this.saved && this.draft
      ? diffConfigs(this.saved, this.draft)
      : [];
  }

  get draftToml(): string | null {
    return this.draft ? serializeConfig(this.draft) : null;
  }

  get effectiveJson(): string {
    return JSON.stringify(this.effective ?? {}, null, 2);
  }

  get errors(): ValidationIssue[] {
    return this.validation?.errors ?? [];
  }

  get validationWarnings(): ValidationIssue[] {
    return this.validation?.warnings ?? [];
  }

  get allWarnings(): string[] {
    return [
      ...new Set([
        ...this.warnings,
        ...this.parseWarnings,
        ...this.validationWarnings.map((item) => item.message),
      ]),
    ].filter((item) => item.trim());
  }

  get hasBlockingWarnings(): boolean {
    return this.unknownKeys.length > 0 || this.parseWarnings.length > 0;
  }

  fieldError(path: string): ValidationIssue | undefined {
    return this.errors.find((item) => item.path === path);
  }

  fieldWarning(path: string): ValidationIssue | undefined {
    return this.validationWarnings.find((item) => item.path === path);
  }

  async load(path: string): Promise<boolean> {
    const generation = ++this.generation;
    this.revision += 1;
    if (this.path !== path) {
      this.lastBackup = null;
      this.backups = [];
    }
    this.state = "loading";
    this.path = path;
    this.raw = "";
    this.saved = null;
    this.draft = null;
    this.effective = null;
    this.effectivePath = null;
    this.resolvedPath = null;
    this.dataDir = null;
    this.loadError = null;
    this.saveError = null;
    this.usedFullWrite = false;
    this.validation = null;
    this.lastLoadedAt = null;
    this.lastValidatedAt = null;
    this.doctor = null;
    this.saving = false;
    this.validating = false;
    this.syntaxError = null;
    this.engineError = null;
    this.unknownKeys = [];
    this.parseWarnings = [];
    // Warnings belong to the file that produced them. A failed load must not
    // leave the previous workspace's warnings on screen.
    this.warnings = [];
    this.doctorLoading = false;

    try {
      const result = await configRead(path);
      if (generation !== this.generation) {
        return false;
      }
      this.path = result.path;
      this.raw = result.raw;
      this.effective = result.config;
      this.effectivePath = result.resolvedPath;
      this.resolvedPath = result.resolvedPath;
      this.dataDir = result.dataDir;
      this.warnings = result.warnings;
      this.engineError = result.engineError;
      this.syntaxError = result.syntaxError;

      if (result.syntaxError) {
        this.saved = null;
        this.draft = null;
        this.state = "error";
        this.loadError = {
          code: "CONFIG_TOML_INVALID",
          message: result.syntaxError,
          retryable: false,
        };
        return false;
      }

      const parsed = parseConfigToml(result.raw);
      this.saved = cloneConfig(parsed.model);
      this.draft = cloneConfig(parsed.model);
      this.unknownKeys = parsed.unknownKeys;
      this.parseWarnings = parsed.warnings;
      this.state = "ready";
      this.lastLoadedAt = new Date().toISOString();
      return true;
    } catch (error) {
      if (generation !== this.generation) {
        return false;
      }
      this.state = "error";
      this.saved = null;
      this.draft = null;
      this.loadError = toAppError(error, "CONFIG_READ");
      return false;
    }
  }

  async reload(): Promise<boolean> {
    return this.path ? this.load(this.path) : false;
  }

  set(path: string, value: unknown): void {
    if (!this.draft) {
      return;
    }
    this.draft = setConfigValue(this.draft, path, value);
    this.revision += 1;
    this.validation = null;
    this.saveError = null;
  }

  discard(): void {
    if (this.saved) {
      this.draft = cloneConfig(this.saved);
    }
    this.revision += 1;
    this.validation = null;
    this.saveError = null;
  }

  async validate(): Promise<ValidationOutcome> {
    if (!this.draft || !this.path || this.validating) {
      return "skipped";
    }
    const generation = this.generation;
    const revision = this.revision;
    const local = validateConfig(this.draft);
    const content = serializeConfig(this.draft);
    const checkedAt = new Date().toISOString();
    this.validating = true;
    this.saveError = null;
    try {
      if (!local.valid) {
        this.validation = {
          valid: false,
          checkedAt,
          syntaxError: null,
          engineMessage: null,
          errors: local.errors,
          warnings: local.warnings,
          envelope: null,
        };
        this.lastValidatedAt = checkedAt;
        return "invalid";
      }
      const result = await configValidate(this.path, content);
      if (generation !== this.generation) {
        return "skipped";
      }
      // The user kept typing while the engine validated the previous content;
      // that answer does not describe the current draft.
      if (revision !== this.revision) {
        return "skipped";
      }
      const engine = result.envelope;
      const errors = [...local.errors];
      const warnings = [...local.warnings];
      let engineMessage: string | null = null;
      if (engine && !engine.ok) {
        engineMessage = engine.error.message;
        errors.push(...engineIssues(engine.error.message));
        warnings.push(
          ...engine.warnings.map((message) => ({ path: "", message })),
        );
      } else if (engine?.ok) {
        warnings.push(
          ...engine.warnings.map((message) => ({ path: "", message })),
        );
      }
      const valid =
        result.valid && local.valid && (!engine || engine.ok === true);
      this.validation = {
        valid,
        checkedAt,
        syntaxError: result.syntaxError,
        engineMessage,
        errors: dedupeIssues(errors),
        warnings: dedupeIssues(warnings),
        envelope: engine,
      };
      this.lastValidatedAt = checkedAt;
      return valid ? "valid" : "invalid";
    } catch (error) {
      if (generation !== this.generation || revision !== this.revision) {
        return "skipped";
      }
      const appError = toAppError(error, "CONFIG_VALIDATE");
      this.validation = {
        valid: false,
        checkedAt,
        syntaxError: null,
        engineMessage: appError.message,
        errors: local.errors,
        warnings: local.warnings,
        envelope: null,
      };
      this.lastValidatedAt = checkedAt;
      return "invalid";
    } finally {
      // A newer load/validation may already own the flag after a workspace
      // switch; an older request must not clear it.
      if (generation === this.generation) {
        this.validating = false;
      }
    }
  }

  async save(): Promise<boolean> {
    if (!this.draft || !this.path || this.saving) {
      return false;
    }
    const local = validateConfig(this.draft);
    if (!local.valid) {
      this.validation = {
        valid: false,
        checkedAt: new Date().toISOString(),
        syntaxError: null,
        engineMessage: null,
        errors: local.errors,
        warnings: local.warnings,
        envelope: null,
      };
      this.lastValidatedAt = this.validation.checkedAt;
      this.saveError = {
        code: "CONFIG_INVALID",
        message: "Fix the highlighted fields before saving.",
        retryable: false,
      };
      return false;
    }

    const generation = this.generation;
    const patches = diffToPatches(this.diff, this.draft);
    const draftSnapshot = cloneConfig(this.draft);
    if (patches.length === 0) {
      // Never claim a save when no field patch would reach the engine: the
      // file and the "saved" model would silently diverge.
      this.saveError = {
        code: "CONFIG_NOTHING_TO_WRITE",
        message: "Nothing to write: the draft has no field changes to save.",
        retryable: false,
      };
      return false;
    }
    this.saving = true;
    this.saveError = null;
    this.usedFullWrite = false;
    try {
      const outcome = await configPatch(this.path, patches);
      if (generation !== this.generation) {
        return false;
      }
      if (outcome.backup) {
        this.lastBackup = outcome.backup;
        this.backups = [
          outcome.backup,
          ...this.backups.filter((item) => item !== outcome.backup),
        ].slice(0, 5);
      }
      this.raw = outcome.raw;
      this.effective = outcome.config ?? this.effective;
      this.warnings = outcome.warnings;
      this.engineError = outcome.engineError;
      this.saved = draftSnapshot;
      const currentDraft = this.draft;
      if (currentDraft && !configsEqual(currentDraft, draftSnapshot)) {
        // The user kept typing while the engine wrote the file. Keep those
        // edits and let the diff show them; replacing the draft here is the
        // silent data loss this guard exists to prevent.
        this.validation = null;
      } else {
        this.draft = cloneConfig(draftSnapshot);
        const checkedAt = new Date().toISOString();
        this.validation = {
          valid: true,
          checkedAt,
          syntaxError: null,
          engineMessage: null,
          errors: [],
          warnings: [
            ...local.warnings,
            ...outcome.warnings.map((message) => ({ path: "", message })),
          ],
          envelope: null,
        };
        this.lastValidatedAt = checkedAt;
      }
      this.revision += 1;
      await this.refreshEffective();
      return true;
    } catch (error) {
      if (generation !== this.generation) {
        return false;
      }
      const appError = toAppError(error, "CONFIG_WRITE");
      if (isPatchUnavailable(appError)) {
        return this.writeFull(draftSnapshot, local.warnings);
      }
      await this.validate();
      this.saveError = appError;
      return false;
    } finally {
      // Same guard as validate: a workspace switch resets the flags and may
      // start a new save before this one settles.
      if (generation === this.generation) {
        this.saving = false;
      }
    }
  }

  /**
   * Older shells may not expose `config_patch`. Fall back to the full TOML
   * serializer; comments and key order are lost, so the caller surfaces
   * `saveError`/warnings instead of claiming a comment-preserving write.
   */
  private async writeFull(
    snapshot: ConfigModel,
    warnings: ValidationIssue[],
  ): Promise<boolean> {
    if (!this.path) {
      return false;
    }
    const generation = this.generation;
    const content = serializeConfig(snapshot);
    try {
      const outcome = await configWrite(this.path, content);
      if (generation !== this.generation) {
        return false;
      }
      if (outcome.backup) {
        this.lastBackup = outcome.backup;
        this.backups = [
          outcome.backup,
          ...this.backups.filter((item) => item !== outcome.backup),
        ].slice(0, 5);
      }
      this.raw = content;
      this.saved = cloneConfig(snapshot);
      this.usedFullWrite = true;
      const currentDraft = this.draft;
      if (currentDraft && !configsEqual(currentDraft, snapshot)) {
        this.validation = null;
      } else {
        this.draft = cloneConfig(snapshot);
        const checkedAt = new Date().toISOString();
        this.validation = {
          valid: true,
          checkedAt,
          syntaxError: null,
          engineMessage: null,
          errors: [],
          warnings,
          envelope: null,
        };
        this.lastValidatedAt = checkedAt;
      }
      this.revision += 1;
      await this.refreshEffective();
      return true;
    } catch (error) {
      if (generation !== this.generation) {
        return false;
      }
      const appError = toAppError(error, "CONFIG_WRITE");
      await this.validate();
      this.saveError = appError;
      return false;
    }
  }

  async runDoctor(): Promise<boolean> {
    if (this.doctorLoading) {
      return false;
    }
    const generation = this.generation;
    const path = this.path;
    this.doctorLoading = true;
    try {
      const doctor = await runDoctor(path);
      // A workspace switch while doctor ran makes this result belong to the
      // previous file; dropping it avoids showing stale diagnostics.
      if (generation !== this.generation) {
        return false;
      }
      this.doctor = doctor;
      return doctor.ok;
    } finally {
      if (generation === this.generation) {
        this.doctorLoading = false;
      }
    }
  }

  private async refreshEffective(): Promise<void> {
    if (!this.path) {
      return;
    }
    const generation = this.generation;
    try {
      const result = await configRead(this.path);
      if (generation !== this.generation) {
        return;
      }
      this.effective = result.config;
      this.effectivePath = result.resolvedPath;
      this.resolvedPath = result.resolvedPath;
      this.dataDir = result.dataDir;
      this.warnings = result.warnings;
      this.engineError = result.engineError;
    } catch {
      // The write already succeeded; keep the draft and surface the old
      // effective view rather than turning a successful save into an error.
    }
  }
}

function isPatchUnavailable(error: AppError): boolean {
  return (
    error.code === "INVALID_COMMAND" ||
    /command .*not found|unknown command|not allowed|not supported/i.test(
      error.message,
    )
  );
}

function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const out: ValidationIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.path}\u0000${issue.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(issue);
  }
  return out;
}

function engineIssues(message: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pattern = /([a-z][a-z0-9_.]*)\s*:\s*([^;]+)/gi;
  for (const match of message.matchAll(pattern)) {
    const path = match[1];
    if (!KNOWN_ROOTS.has(path.split(".")[0])) {
      continue;
    }
    issues.push({ path, message: match[2].trim() });
  }
  return issues.length ? issues : [{ path: "", message }];
}
