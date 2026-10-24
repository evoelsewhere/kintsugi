// A shallow check of an agent's structured result against the JSON schema its step gave it: the
// top-level type, the required properties and the type of each property that is present. Deeper
// rules (enums, patterns, items) stay with the step that consumes the result. It exists so that an
// empty or wrongly shaped result earns the agent its repair attempt instead of failing later.

interface Schema {
  type?: unknown;
  properties?: Record<string, Schema>;
  required?: unknown;
}

const typeOf = (value: unknown): string => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);

const matchesType = (type: unknown, value: unknown): boolean => {
  const actual = typeOf(value);
  const allowed = Array.isArray(type) ? type : [type];
  return allowed.some((entry) => entry === actual || (entry === "integer" && Number.isInteger(value)) || (entry === "number" && actual === "number"));
};

/** What is wrong with `value` against `schema`, or undefined when it fits (or the schema says nothing checkable). */
export function shapeProblem(schema: unknown, value: unknown): string | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const { type, properties, required } = schema as Schema;
  if (type !== undefined && !matchesType(type, value)) return `expected ${Array.isArray(type) ? type.join(" or ") : String(type)}, got ${typeOf(value)}`;
  if (typeOf(value) !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const missing = (Array.isArray(required) ? required : []).filter((key): key is string => typeof key === "string" && !(key in record));
  if (missing.length > 0) return `missing ${missing.join(", ")}`;
  for (const [key, child] of Object.entries(properties ?? {})) {
    const childType = (child as Schema | null)?.type;
    if (key in record && childType !== undefined && !matchesType(childType, record[key])) return `${key} should be ${Array.isArray(childType) ? childType.join(" or ") : String(childType)}, got ${typeOf(record[key])}`;
  }
  return undefined;
}

/**
 * A model often wraps the result in one extra key (`{"result": {...}}`, `{"verdict": {...}}`). When the value does
 * not fit but its only property does, that property is the result; any other value comes back unchanged.
 */
export function unwrapResult(schema: unknown, value: unknown): unknown {
  if (shapeProblem(schema, value) === undefined || typeOf(value) !== "object") return value;
  const values = Object.values(value as Record<string, unknown>);
  const inner = values.length === 1 ? values[0] : undefined;
  return inner !== undefined && typeOf(inner) === "object" && shapeProblem(schema, inner) === undefined ? inner : value;
}

/** The property names of a value (names only, bounded, one line each): enough to tell an agent what it wrote instead. */
export function keysOf(value: unknown): string {
  if (typeOf(value) !== "object") return typeOf(value);
  const names = Object.keys(value as Record<string, unknown>)
    .slice(0, 8)
    .map((name) => name.replace(/[^\w.-]/g, "?").slice(0, 40));
  return names.length === 0 ? "no properties" : names.join(", ");
}

const PLACEHOLDER: Record<string, unknown> = { string: "...", boolean: false, integer: 0, number: 0, array: [], object: {} };

/** A minimal value of the schema's required properties (the first enum value, a placeholder by type), as JSON for a repair note. */
export function exampleOf(schema: unknown): string | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const { properties, required } = schema as Schema & { properties?: Record<string, Schema & { enum?: unknown[] }> };
  const names = (Array.isArray(required) ? required : []).filter((key): key is string => typeof key === "string");
  if (names.length === 0) return undefined;
  const example: Record<string, unknown> = {};
  for (const name of names) {
    const child = properties?.[name];
    const type = Array.isArray(child?.type) ? child?.type[0] : child?.type;
    example[name] = child?.enum?.[0] ?? (typeof type === "string" && type in PLACEHOLDER ? PLACEHOLDER[type] : "...");
  }
  return JSON.stringify(example);
}
