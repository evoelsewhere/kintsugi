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
