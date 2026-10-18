import { describe, expect, it } from "vitest";
import { idOfAnchor, resolveDocumentLink, stageOfDocument } from "./document-links";

const README = "applications/web/generated/README.md";

describe("resolveDocumentLink", () => {
  it("resolves relative links against the document's folder", () => {
    expect(resolveDocumentLink("core/a.md", README)).toEqual({ kind: "document", path: "applications/web/generated/core/a.md" });
    expect(resolveDocumentLink("./core/a.md#inputs", README)).toEqual({ kind: "document", path: "applications/web/generated/core/a.md", anchor: "inputs" });
    expect(resolveDocumentLink("../b.md", "applications/web/generated/core/a.md")).toEqual({ kind: "document", path: "applications/web/generated/b.md" });
    expect(resolveDocumentLink("../../../applications/web/assessment/SECURITY_FINDINGS.md#sec-001", README)).toEqual({ kind: "document", path: "applications/web/assessment/SECURITY_FINDINGS.md", anchor: "sec-001" });
    expect(resolveDocumentLink("my%20unit.md", README)).toEqual({ kind: "document", path: "applications/web/generated/my unit.md" });
  });

  it("reads a leading slash from the repo root and a bare anchor as the same document", () => {
    expect(resolveDocumentLink("/applications/web/assessment/BUSINESS_RULES.md", README)).toEqual({ kind: "document", path: "applications/web/assessment/BUSINESS_RULES.md" });
    expect(resolveDocumentLink("#rule-001", "applications/web/assessment/BUSINESS_RULES.md")).toEqual({ kind: "document", path: "applications/web/assessment/BUSINESS_RULES.md", anchor: "rule-001" });
  });

  it("keeps web links external and blocks other schemes", () => {
    expect(resolveDocumentLink("https://owasp.org/x", README)).toEqual({ kind: "external", href: "https://owasp.org/x" });
    expect(resolveDocumentLink("javascript:alert(1)", README).kind).toBe("blocked");
    expect(resolveDocumentLink("file:///etc/passwd", README).kind).toBe("blocked");
    expect(resolveDocumentLink("//evil.example/x", README).kind).toBe("blocked");
  });

  it("never follows a link out of the repo or under restricted/ or .git", () => {
    expect(resolveDocumentLink("../../../../etc/passwd", README).kind).toBe("blocked");
    expect(resolveDocumentLink("/../x.md", README).kind).toBe("blocked");
    expect(resolveDocumentLink("../../../restricted/SECRETS.local.md", README).kind).toBe("blocked");
    expect(resolveDocumentLink("../../../Restricted/x.md", README).kind).toBe("blocked");
    expect(resolveDocumentLink("..\\..\\..\\restricted\\x.md", README).kind).toBe("blocked");
    expect(resolveDocumentLink("/.git/config", README).kind).toBe("blocked");
  });
});

describe("stageOfDocument", () => {
  it("names the stage whose main document a path is", () => {
    expect(stageOfDocument("applications/web/assessment/SECURITY_FINDINGS.md")).toEqual({ stage: "harden", app: "web" });
    expect(stageOfDocument("applications/web/assessment/BUSINESS_RULES.md")).toEqual({ stage: "extract-rules", app: "web" });
    expect(stageOfDocument("applications/web/generated/README.md")).toEqual({ stage: "understand", app: "web" });
    expect(stageOfDocument("applications/web/units/orders/order-entry/as-is.md")).toBeUndefined();
  });
});

describe("idOfAnchor", () => {
  it("finds the id a heading anchor names", () => {
    const ids = ["SEC-001", "SEC-0011", "SEC-002"];
    expect(idOfAnchor("sec-001", ids)).toBe("SEC-001");
    expect(idOfAnchor("sec-0011--sql-injection", ids)).toBe("SEC-0011");
    expect(idOfAnchor("sec-003", ids)).toBeUndefined();
    expect(idOfAnchor(undefined, ids)).toBeUndefined();
  });
});
