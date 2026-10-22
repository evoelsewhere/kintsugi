import { describe, expect, it } from "vitest";
import { parseUnitDocument } from "../src/unit-document.js";

const UNIT = [
  "---",
  "id: billing/invoices/tax",
  "application: billing",
  "module: invoices",
  "kind: calculation",
  "title: Invoice tax",
  "phase: migrate",
  "status: pending",
  "waived:",
  "  - \"detail/data-access.md: no data store\"",
  "source:",
  "  - repo: legacy",
  "    paths: [src/tax.ts]",
  "---",
  "The tax calculation.",
].join("\n");

describe("parseUnitDocument", () => {
  it("parses strict YAML frontmatter with the shared WorkItemFile schema", () => {
    const result = parseUnitDocument(UNIT, "billing/invoices/tax");
    expect(result).toMatchObject({
      ok: true,
      value: {
        id: "billing/invoices/tax",
        application: "billing",
        module: "invoices",
        kind: "calculation",
        title: "Invoice tax",
        source: [{ repo: "legacy", paths: ["src/tax.ts"] }],
        waived: ["detail/data-access.md: no data store"],
      },
    });
  });

  it("rejects missing or malformed frontmatter without leaking document contents", () => {
    const missing = parseUnitDocument("# no state");
    const malformed = parseUnitDocument("---\nid: [secret\n---\nprivate body");
    expect(missing.ok).toBe(false);
    expect(malformed.ok).toBe(false);
    if (!missing.ok && !malformed.ok) {
      expect(missing.issues[0]?.message).toMatch(/frontmatter/i);
      expect(malformed.issues.map((issue) => issue.message).join(" ")).not.toContain("private body");
    }
  });

  it("rejects a unit identity that does not match its containing path", () => {
    const result = parseUnitDocument(UNIT, "billing/invoices/other");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual({ path: "id", message: "must match the unit path" });
  });

  it("rejects gate decisions in card frontmatter", () => {
    const withGate = UNIT.replace("status: pending", "status: pending\ngates:\n  G3:\n    status: approved");
    const result = parseUnitDocument(withGate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual({ path: "gates", message: "unknown key" });
  });
  it("rejects duplicate YAML keys and unsupported frontmatter fields", () => {
    const duplicate = parseUnitDocument(UNIT.replace("title: Invoice tax", "title: Invoice tax\ntitle: Forged"));
    const unknown = parseUnitDocument(UNIT.replace("status: pending", "status: pending\nassignment: alice"));
    expect(duplicate.ok).toBe(false);
    expect(unknown.ok).toBe(false);
  });

  it("bounds unit state documents before parsing", () => {
    const result = parseUnitDocument("---\nid: billing/invoices/tax\n---\n" + "x".repeat(300_000));
    expect(result.ok).toBe(false);
  });
});
