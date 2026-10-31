// Field errors from an API refusal: the API's schema validation answers 400 with messages such as
// "username: must be lowercase kebab-case", and a service names the field first ("Username jane already exists").
// Each message that starts with a field of the form goes to that field; the rest stay for the form as a whole.

import { ApiError } from "./api";

export interface FormErrors<F extends string> {
  /** The messages per field, joined. */
  fields: Partial<Record<F, string>>;
  /** What belongs to no field, or null. */
  form: string | null;
}

/** Splits the messages of a failure into the fields they name and the rest. */
export function formErrorsOf<F extends string>(failure: unknown, fields: readonly F[]): FormErrors<F> {
  const messages = failure instanceof ApiError
    ? (typeof failure.body.message === "string" ? [failure.body.message] : failure.body.message)
    : [failure instanceof Error ? failure.message : String(failure)];
  const byField: Partial<Record<F, string[]>> = {};
  const rest: string[] = [];
  for (const message of messages) {
    const field = fieldOf(message, fields);
    if (field === undefined) {
      rest.push(message);
      continue;
    }
    // "username: must be …" keeps only the reason; "Username jane already exists" reads well as it is.
    const text = message.startsWith(`${field}:`) ? message.slice(field.length + 1).trim() : message;
    (byField[field] ??= []).push(text);
  }
  const result: Partial<Record<F, string>> = {};
  for (const field of fields) {
    const list = byField[field];
    if (list !== undefined) result[field] = list.join("; ");
  }
  return { fields: result, form: rest.length === 0 ? null : rest.join("; ") };
}

function fieldOf<F extends string>(message: string, fields: readonly F[]): F | undefined {
  const first = /^([A-Za-z]+)[:\s]/.exec(message)?.[1]?.toLowerCase();
  return fields.find((field) => field.toLowerCase() === first);
}
