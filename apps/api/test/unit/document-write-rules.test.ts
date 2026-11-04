// The rules of the write contract (design-writer-contract, section 5), checked without a database.

import { describe, expect, it } from "vitest";
import type { DocumentWriteFile } from "../../src/modules/admin/document-writes/domain/document-write.js";
import { MAX_FILE_BYTES, MAX_WRITE_BYTES, MAX_WRITE_ENTRIES, contentBytes, documentWriteProblems } from "../../src/modules/admin/document-writes/domain/document-write.rules.js";

const HASH = "a".repeat(64);
const page = { id: "PAGE-SHOP-0001", path: "01-standards/naming.md", minor: false };
const problems = (files: DocumentWriteFile[], extra: Partial<Parameters<typeof documentWriteProblems>[0]> = {}): string[] => documentWriteProblems({ kind: "page", files, page, ...extra });
const write = (path: string, extra: Partial<DocumentWriteFile> = {}): DocumentWriteFile => ({ path, content: "# Page\n", ...extra });

describe("documentWriteProblems", () => {
  it("accepts a page, an attachment in base64, a delete and a rename", () => {
    expect(
      problems([
        write("01-standards/naming.md", { expectedHash: HASH }),
        write("01-standards/_attachments/figure.png", { content: Buffer.from([1, 2, 3]).toString("base64"), encoding: "base64" }),
        { path: "01-standards/old.md", content: "", delete: true, expectedHash: HASH },
        write("01-standards/new.md", { renameFrom: "01-standards/previous.md", expectedHash: HASH }),
      ]),
    ).toEqual([]);
  });

  it("counts a base64 file by the bytes it stands for", () => {
    expect(contentBytes({ content: Buffer.alloc(10).toString("base64"), encoding: "base64" })).toBe(10);
    expect(contentBytes({ content: Buffer.alloc(11).toString("base64"), encoding: "base64" })).toBe(11);
    expect(contentBytes({ content: Buffer.alloc(12).toString("base64"), encoding: "base64" })).toBe(12);
    expect(contentBytes({ content: "é" })).toBe(2);
  });

  it("refuses unsafe paths, and for a page a path that is not editable, naming the path", () => {
    expect(problems([write("../outside.md")]).join()).toContain('"../outside.md"');
    expect(problems([write("a//b.md")]).join()).toMatch(/empty/);
    expect(problems([write("a\\b.md")]).join()).toMatch(/backslashes/);
    expect(problems([write("/abs.md")]).join()).toMatch(/absolute/);
    expect(problems([write("docs/.git/config.md")]).join()).toMatch(/\.git/);
    for (const path of ["_generated/out.md", "restricted/secret.md", "plugins/x/README.md", "scratch/a/inventory.md", "kintsugi.yaml", "notes.txt", ".hidden/page.md"]) {
      expect(problems([write(path)]).join(), path).toContain(`"${path}"`);
    }
    // Other kinds only need a safe path: the manifest is not a wiki page.
    expect(documentWriteProblems({ kind: "manifest", files: [write("kintsugi.yaml")] })).toEqual([]);
    expect(documentWriteProblems({ kind: "manifest", files: [write("../kintsugi.yaml")] }).join()).toContain('"../kintsugi.yaml"');
  });

  it("needs files, at most 500 of them, each target once", () => {
    expect(problems([])).toContain("A write needs at least one file");
    const many = Array.from({ length: MAX_WRITE_ENTRIES }, (_, at) => write(`pages/p${at}.md`));
    expect(problems(many)).toEqual([]);
    expect(problems([...many, write("pages/extra.md")]).join()).toMatch(/at most 500 files.*has 501/);
    expect(problems([write("a.md"), write("a.md")]).join()).toMatch(/written twice/);
  });

  it("limits a file to 5 MiB and a write to 50 MiB, in bytes", () => {
    expect(problems([write("big.md", { content: "x".repeat(MAX_FILE_BYTES) })])).toEqual([]);
    expect(problems([write("big.md", { content: "x".repeat(MAX_FILE_BYTES + 1) })]).join()).toMatch(/larger than 5 MiB/);
    const eleven = Array.from({ length: 11 }, (_, at) => write(`big${at}.md`, { content: "x".repeat(MAX_FILE_BYTES) }));
    expect(MAX_FILE_BYTES * eleven.length).toBeGreaterThan(MAX_WRITE_BYTES);
    expect(problems(eleven).join()).toMatch(/at most 50 MiB/);
  });

  it("needs a valid base64 content when it says base64, and an attachment is binary", () => {
    expect(problems([write("_attachments/a.png", { content: "not base64!", encoding: "base64" })]).join()).toMatch(/not valid base64/);
    expect(problems([write("01-standards/_attachments/a.png")]).join()).toMatch(/send it as base64/);
  });

  it("needs expectedHash for a delete and a rename, and refuses the contradictions", () => {
    expect(problems([{ path: "a.md", content: "", delete: true }]).join()).toMatch(/delete needs expectedHash/);
    expect(problems([write("b.md", { renameFrom: "a.md" })]).join()).toMatch(/rename needs expectedHash/);
    expect(problems([write("b.md", { renameFrom: "b.md", expectedHash: HASH })]).join()).toMatch(/same path/);
    expect(problems([{ path: "a.md", content: "text", delete: true, expectedHash: HASH }]).join()).toMatch(/no content/);
    expect(problems([{ path: "a.md", content: "", delete: true, renameFrom: "z.md", expectedHash: HASH }]).join()).toMatch(/no content, rename or createOnly/);
    expect(problems([write("b.md", { renameFrom: "a.md", expectedHash: HASH, createOnly: true })]).join()).toMatch(/not createOnly/);
    expect(problems([write("a.md", { expectedHash: "not-a-hash" })]).join()).toMatch(/not a SHA-256/);
    expect(problems([write("b.md", { renameFrom: "../a.md", expectedHash: HASH })]).join()).toMatch(/renameFrom/);
    expect(problems([write("b.md", { renameFrom: "restricted/a.md", expectedHash: HASH })]).join()).toContain('renameFrom "restricted/a.md"');
  });

  it("refuses a moved path that another entry writes, and a path moved twice", () => {
    expect(problems([write("b.md", { renameFrom: "a.md", expectedHash: HASH }), write("a.md")]).join()).toMatch(/moved and also written/);
    expect(problems([write("b.md", { renameFrom: "a.md", expectedHash: HASH }), write("c.md", { renameFrom: "a.md", expectedHash: HASH })]).join()).toMatch(/moved twice/);
  });

  it("keeps page-only things to page writes, and a page write names its page", () => {
    expect(problems([write("a.md")], { page: undefined }).join()).toMatch(/names its page/);
    expect(problems([write("a.md")], { page: { id: null, path: "restricted/x.md", minor: false } }).join()).toContain('"restricted/x.md"');
    expect(problems([write("a.md")], { continues: "main" }).join()).toMatch(/kintsugi\/\* branch/);
    expect(problems([write("a.md")], { continues: "kintsugi/alice/page", directPublish: true })).toEqual([]);
    const other = { kind: "state-change" as const, files: [write("a.md")] };
    expect(documentWriteProblems({ ...other, page })).toContain("Only a page write names a page");
    expect(documentWriteProblems({ ...other, directPublish: true })).toContain("Only a page write can publish directly");
    expect(documentWriteProblems({ ...other, continues: "kintsugi/x" })).toContain("Only a page write can continue a branch");
    expect(documentWriteProblems({ ...other, files: [{ path: "a.md", content: "", delete: true, expectedHash: HASH }] }).join()).toMatch(/only a page write can delete or rename/);
    expect(documentWriteProblems(other)).toEqual([]);
  });
});
