import { describe, expect, it } from "vitest";
import { idOfAnchor, resolveDocumentLink, stageOfDocument } from "./document-links";

const README = "knowledge/as-is/web/README.md";

describe("resolveDocumentLink", () => {
  it("resolves relative links against the document's folder", () => {
    expect(resolveDocumentLink("core/a.md", README)).toEqual({ kind: "document", path: "knowledge/as-is/web/core/a.md" });
    expect(resolveDocumentLink("./core/a.md#inputs", README)).toEqual({ kind: "document", path: "knowledge/as-is/web/core/a.md", anchor: "inputs" });
    expect(resolveDocumentLink("../b.md", "knowledge/as-is/web/core/a.md")).toEqual({ kind: "document", path: "knowledge/as-is/web/b.md" });
    expect(resolveDocumentLink("../../../assessment/web/SECURITY_FINDINGS.md#sec-001", README)).toEqual({ kind: "document", path: "assessment/web/SECURITY_FINDINGS.md", anchor: "sec-001" });
    expect(resolveDocumentLink("my%20unit.md", README)).toEqual({ kind: "document", path: "knowledge/as-is/web/my unit.md" });
  });

  it("reads a leading slash from the repo root and a bare anchor as the same document", () => {
    expect(resolveDocumentLink("/assessment/web/BUSINESS_RULES.md", README)).toEqual({ kind: "document", path: "assessment/web/BUSINESS_RULES.md" });
    expect(resolveDocumentLink("#rule-001", "assessment/web/BUSINESS_RULES.md")).toEqual({ kind: "document", path: "assessment/web/BUSINESS_RULES.md", anchor: "rule-001" });
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
    expect(stageOfDocument("assessment/web/SECURITY_FINDINGS.md")).toEqual({ stage: "harden", app: "web" });
    expect(stageOfDocument("assessment/web/BUSINESS_RULES.md")).toEqual({ stage: "extract-rules", app: "web" });
    expect(stageOfDocument("knowledge/as-is/web/README.md")).toEqual({ stage: "understand", app: "web" });
    expect(stageOfDocument("knowledge/as-is/web/core/a.md")).toBeUndefined();
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
