import type { ValidationProblem } from "./project.js";

/** Result returned by pure domain validators for untyped Git or wire input. */
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationProblem[] };

/** API identifiers deliberately allow 100 characters; unit path segments have a separate 63-character limit. */
export const IDENTIFIER_MAX_LENGTH = 100;
export const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const PROJECT_ID_PATTERN = new RegExp("^[a-z0-9][a-z0-9-]{0," + (IDENTIFIER_MAX_LENGTH - 1) + "}$");
export const MAX_TASK_TITLE_LENGTH = 500;
export const MAX_TASK_ASSIGNEE_LENGTH = 200;
export const MAX_REQUIRED_DELIVERABLES = 100;
export const DELIVERABLE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;
export const MAX_REPOSITORY_PATH_LENGTH = 1000;

/** Relative Git file path, without metadata, traversal, drive prefixes, or control characters. */
export function isSafeRepositoryPath(path: string): boolean {
  return path.length > 0 && path.length <= MAX_REPOSITORY_PATH_LENGTH &&
    !/[\\\p{Cc}]/u.test(path) && !/^(?:\/|[a-z]:)/i.test(path) &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".." && segment.toLowerCase() !== ".git");
}

type JsonObject = Record<string, unknown>;

/** Small shared reader for strict, path-aware validation of untyped domain documents. */
export class DomainValidationReader {
  readonly issues: ValidationProblem[] = [];

  problem(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  object(value: unknown, path: string, allowedKeys: readonly string[]): JsonObject | undefined {
    const record = this.record(value, path);
    if (record === undefined) return undefined;
    for (const key of Object.keys(record)) {
      if (!allowedKeys.includes(key)) this.problem(joinPath(path, key), "unknown key");
    }
    return record;
  }

  record(value: unknown, path: string): JsonObject | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.problem(path, "must be a mapping");
      return undefined;
    }
    return value as JsonObject;
  }

  array(value: unknown, path: string, options: { nonEmpty?: boolean; maxLength?: number } = {}): unknown[] | undefined {
    if (!Array.isArray(value)) {
      this.problem(path, "must be a list");
      return undefined;
    }
    if (options.nonEmpty === true && value.length === 0) this.problem(path, "must not be empty");
    if (options.maxLength !== undefined && value.length > options.maxLength) {
      this.problem(path, "has too many entries");
    }
    return value;
  }

  string(value: unknown, path: string, options: { allowEmpty?: boolean; pattern?: RegExp; maxLength?: number } = {}): string | undefined {
    if (typeof value !== "string") {
      this.problem(path, "must be a string");
      return undefined;
    }
    const normalized = value.trim();
    if (options.allowEmpty !== true && normalized === "") {
      this.problem(path, "must be a non-empty string");
      return undefined;
    }
    if (options.maxLength !== undefined && normalized.length > options.maxLength) {
      this.problem(path, "is too long");
      return undefined;
    }
    if (options.pattern !== undefined && !options.pattern.test(normalized)) {
      this.problem(path, "has an invalid format");
      return undefined;
    }
    return normalized;
  }

  optionalString(value: unknown, path: string, options: { allowEmpty?: boolean; pattern?: RegExp; maxLength?: number } = {}): string | undefined {
    return value === undefined ? undefined : this.string(value, path, options);
  }

  oneOf<const T extends string>(value: unknown, path: string, allowed: readonly T[]): T | undefined {
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
    this.problem(path, "must be one of " + allowed.join(", "));
    return undefined;
  }

  strings(value: unknown, path: string, options: { nonEmpty?: boolean; unique?: boolean; maxLength?: number; itemMaxLength?: number } = {}): string[] | undefined {
    const list = this.array(value, path, { nonEmpty: options.nonEmpty, maxLength: options.maxLength });
    if (list === undefined) return undefined;
    const result: string[] = [];
    const seen = new Set<string>();
    list.forEach((entry, index) => {
      const text = this.string(entry, path + "[" + index + "]", { maxLength: options.itemMaxLength });
      if (text === undefined) return;
      if (options.unique === true && seen.has(text)) this.problem(path + "[" + index + "]", "must be unique");
      seen.add(text);
      result.push(text);
    });
    return result;
  }

  boolean(value: unknown, path: string): boolean | undefined {
    if (typeof value !== "boolean") {
      this.problem(path, "must be true or false");
      return undefined;
    }
    return value;
  }

  finiteNumber(value: unknown, path: string): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.problem(path, "must be a finite number");
      return undefined;
    }
    return value;
  }

  result<T>(value: T): ValidationResult<T> {
    return this.issues.length === 0 ? { ok: true, value } : { ok: false, issues: this.issues };
  }
}

function joinPath(path: string, child: string): string {
  return path === "" ? child : path + "." + child;
}
