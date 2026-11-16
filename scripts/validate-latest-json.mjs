#!/usr/bin/env node
/**
 * Validate `latest.json` against `contracts/latest.schema.json`.
 *
 * The release job used to hand-check a few fields inline; a manifest that the
 * gate accepted could still be rejected by tauri-plugin-updater (QA-02). The
 * schema is now the contract and this validator is the gate.
 *
 * Only the JSON Schema subset used by `contracts/latest.schema.json` is
 * implemented (no dependency, no network): $ref, type, const, enum, pattern,
 * minLength, minProperties, required, properties, patternProperties,
 * propertyNames, additionalProperties, items, minItems, uniqueItems.
 *
 * Usage:
 *   node scripts/validate-latest-json.mjs --file dist/latest.json
 *   node scripts/validate-latest-json.mjs --file x.json --schema other.json
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_SCHEMA = join(root, "contracts", "latest.schema.json");

const TYPES = {
  object: (value) => typeof value === "object" && value !== null && !Array.isArray(value),
  array: (value) => Array.isArray(value),
  string: (value) => typeof value === "string",
  integer: (value) => Number.isInteger(value),
  number: (value) => typeof value === "number" && Number.isFinite(value),
  boolean: (value) => typeof value === "boolean",
  null: (value) => value === null,
};

function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "string") {
    const shown = value.length > 40 ? `${value.slice(0, 37)}...` : value;
    return `string ${JSON.stringify(shown)}`;
  }
  return typeof value === "object" ? "object" : `${typeof value} ${String(value)}`;
}

function resolveRef(ref, rootSchema) {
  if (ref === "#") return rootSchema;
  const match = /^#\/(.+)$/.exec(ref);
  if (!match) throw new Error(`unsupported $ref ${ref}`);
  let node = rootSchema;
  for (const part of match[1].split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    node = node?.[key];
    if (node === undefined) throw new Error(`unresolved $ref ${ref}`);
  }
  return node;
}

function walk(value, schema, path, rootSchema, errors, depth) {
  if (depth > 32) {
    errors.push(`${path}: schema recursion is too deep`);
    return;
  }
  if (typeof schema !== "object" || schema === null) return;

  if (typeof schema.$ref === "string") {
    let target;
    try {
      target = resolveRef(schema.$ref, rootSchema);
    } catch (error) {
      errors.push(`${path}: ${error.message}`);
      return;
    }
    walk(value, target, path, rootSchema, errors, depth + 1);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = types.some((type) => (TYPES[type] ? TYPES[type](value) : true));
    if (!matches) {
      errors.push(`${path}: expected ${types.join(" or ")}, got ${describe(value)}`);
      return;
    }
  }

  if ("const" in schema && value !== schema.const) {
    errors.push(`${path}: expected ${JSON.stringify(schema.const)}, got ${describe(value)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: ${describe(value)} is not one of ${schema.enum.join(", ")}`);
  }

  if (typeof value === "string") {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      errors.push(`${path}: length ${value.length} is below the minimum of ${schema.minLength}`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: ${describe(value)} does not match ${schema.pattern}`);
    }
  }

  if (TYPES.object(value)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing required property "${key}"`);
    }
    if (Number.isInteger(schema.minProperties) && Object.keys(value).length < schema.minProperties) {
      errors.push(`${path}: has ${Object.keys(value).length} propert(ies), minimum is ${schema.minProperties}`);
    }
    if (schema.propertyNames) {
      for (const key of Object.keys(value)) {
        const nameErrors = [];
        walk(key, schema.propertyNames, `${path}<${key}>`, rootSchema, nameErrors, depth + 1);
        if (nameErrors.length > 0) {
          errors.push(`${path}: invalid property name ${JSON.stringify(key)}`);
        }
      }
    }

    const matched = new Set();
    for (const [pattern, subSchema] of Object.entries(schema.patternProperties ?? {})) {
      const regex = new RegExp(pattern);
      for (const key of Object.keys(value)) {
        if (!regex.test(key)) continue;
        matched.add(key);
        walk(value[key], subSchema, `${path}[${JSON.stringify(key)}]`, rootSchema, errors, depth + 1);
      }
    }

    for (const [key, subSchema] of Object.entries(properties)) {
      if (!(key in value)) continue;
      walk(value[key], subSchema, `${path}[${JSON.stringify(key)}]`, rootSchema, errors, depth + 1);
    }

    for (const key of Object.keys(value)) {
      if (key in properties || matched.has(key)) continue;
      if (schema.additionalProperties === false) {
        errors.push(`${path}: unexpected property ${JSON.stringify(key)}`);
      } else if (typeof schema.additionalProperties === "object" && schema.additionalProperties !== null) {
        walk(value[key], schema.additionalProperties, `${path}[${JSON.stringify(key)}]`, rootSchema, errors, depth + 1);
      }
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      errors.push(`${path}: has ${value.length} item(s), minimum is ${schema.minItems}`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) errors.push(`${path}: duplicate item ${key}`);
        seen.add(key);
      }
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        walk(item, schema.items, `${path}[${index}]`, rootSchema, errors, depth + 1);
      });
    }
  }
}

/** Error messages for one manifest; an empty array means the schema accepts it. */
export function validateAgainstSchema(value, schema) {
  const errors = [];
  walk(value, schema, "$", schema, errors, 0);
  return errors;
}

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateLatestFile(filePath, schemaPath = DEFAULT_SCHEMA) {
  const latest = loadJson(filePath);
  const schema = loadJson(schemaPath);
  return { latest, errors: validateAgainstSchema(latest, schema) };
}

function main(argv) {
  const args = argv.slice(2);
  const valueAfter = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const file = resolve(root, valueAfter("--file", join("dist", "latest.json")));
  const schema = resolve(root, valueAfter("--schema", DEFAULT_SCHEMA));

  let result;
  try {
    result = validateLatestFile(file, schema);
  } catch (error) {
    console.error(`::error::latest.json validation failed: ${error.message}`);
    process.exit(1);
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`::error::latest.json ${error}`);
    process.exit(1);
  }
  const platforms = Object.keys(result.latest.platforms ?? {});
  console.log(
    `latest.json: valid (version ${result.latest.version}, ${platforms.length} platform(s): ${platforms.join(", ")})`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
