import { describe, expect, it } from "vitest";
import { formatResult } from "../src/render.js";

describe("text output of lists", () => {
  it("shows a project's id beside its name, since commands take the id", () => {
    expect(formatResult({ items: [{ id: "billing-qa", name: "Billing QA" }, { id: "shop", name: "shop" }] }, "text")).toBe("- Billing QA (billing-qa)\n- shop\n");
    expect(formatResult({ items: [{ id: "billing-qa", name: "Billing QA" }] }, "markdown")).toBe("- **Billing QA (billing-qa)**\n");
    // Items without an id read as before.
    expect(formatResult({ items: [{ name: "modernize", title: "Modernize" }] }, "text")).toBe("- modernize\n");
  });
});
