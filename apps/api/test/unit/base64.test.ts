// Base64 text from a request is checked without backtracking: a file of 5 MiB is about 7 MB of text, which a pattern with a
// repeated group cannot match (a RangeError from the regular expression engine).

import { describe, expect, it } from "vitest";
import { decodeBase64, isBase64Text } from "../../src/common/util/base64.js";
import { MAX_FILE_BYTES, documentWriteProblems } from "../../src/modules/admin/document-writes/domain/document-write.rules.js";

describe("isBase64Text and decodeBase64", () => {
  it("takes padded standard base64 and gives its bytes back", () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from("a"), Buffer.from("ab"), Buffer.from("abc"), Buffer.from([0, 255, 254, 253, 1])]) {
      const text = bytes.toString("base64");
      expect(isBase64Text(text)).toBe(true);
      expect(decodeBase64(text)?.equals(bytes)).toBe(true);
    }
  });

  it("refuses text that is not, padding in the wrong place, the URL alphabet and text that is not the canonical form", () => {
    for (const text of ["abc", "ab=c", "a===", "=AAA", "AA AA", "AAAA\n", "A-A_", "é", "QQ=A"]) {
      expect(decodeBase64(text), text).toBeUndefined();
    }
    // Trailing bits that the bytes do not carry: decoding and encoding again gives other text.
    expect(decodeBase64("QR==")).toBeUndefined();
  });

  it("handles 5 MiB of bytes, which is about 7 MB of text, quickly and without a stack overflow", () => {
    const bytes = Buffer.alloc(MAX_FILE_BYTES, 7);
    const text = bytes.toString("base64");
    expect(text.length).toBeGreaterThan(6_900_000);
    const started = Date.now();
    expect(isBase64Text(text)).toBe(true);
    expect(decodeBase64(text)?.equals(bytes)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("lets the write rules check a file of 5 MiB in base64", () => {
    const content = Buffer.alloc(MAX_FILE_BYTES, 7).toString("base64");
    expect(documentWriteProblems({ kind: "page", files: [{ path: "10-eng/_attachments/big.png", content, encoding: "base64" }], page: { id: null, path: "10-eng/guide.md", minor: false } })).toEqual([]);
  });
});
