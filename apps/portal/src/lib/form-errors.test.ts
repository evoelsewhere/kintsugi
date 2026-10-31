import { describe, expect, it, vi } from "vitest";

vi.mock("./session", () => ({ expireSession: () => undefined }));

const { ApiError } = await import("./api");
const { formErrorsOf } = await import("./form-errors");

const refusal = (statusCode: number, message: string | string[]): InstanceType<typeof ApiError> =>
  new ApiError(statusCode, { success: false, statusCode, error: "Bad Request", message, timestamp: "", path: "/api/users" });

describe("formErrorsOf", () => {
  const fields = ["username", "password", "email"] as const;

  it("puts each schema message on the field it names", () => {
    const errors = formErrorsOf(refusal(400, ["username: must be lowercase kebab-case", "password: Too small: expected string to have >=8 characters"]), fields);
    expect(errors.fields).toEqual({ username: "must be lowercase kebab-case", password: "Too small: expected string to have >=8 characters" });
    expect(errors.form).toBeNull();
  });

  it("puts a message that starts with a field's name on that field", () => {
    expect(formErrorsOf(refusal(409, "Username jane already exists"), fields)).toEqual({ fields: { username: "Username jane already exists" }, form: null });
  });

  it("keeps what names no field for the form", () => {
    expect(formErrorsOf(refusal(400, "A member needs exactly one primary role"), fields)).toEqual({ fields: {}, form: "A member needs exactly one primary role" });
    expect(formErrorsOf(new Error("boom"), fields)).toEqual({ fields: {}, form: "boom" });
  });
});
