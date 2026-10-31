import { describe, expect, it } from "vitest";
import { passwordProblem, usernameProblem } from "./member-form";

describe("the member form", () => {
  it("accepts a lowercase kebab-case username and leaves an empty one to the required check", () => {
    expect(usernameProblem("jane-doe")).toBeUndefined();
    expect(usernameProblem("qa2")).toBeUndefined();
    expect(usernameProblem("")).toBeUndefined();
  });

  it("refuses capitals, spaces, a leading hyphen and other characters", () => {
    for (const name of ["Jane", "jane doe", "-jane", "jane_doe", "jane.doe"]) expect(usernameProblem(name), name).toBeDefined();
    expect(usernameProblem("a".repeat(101))).toContain("At most");
  });

  it("asks for at least 8 characters of password, and allows none where it keeps the current one", () => {
    expect(passwordProblem("short")).toBeDefined();
    expect(passwordProblem("long-enough")).toBeUndefined();
    expect(passwordProblem("")).toBeUndefined();
  });
});
