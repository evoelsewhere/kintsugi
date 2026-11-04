// What may be attached to a page: the types, the names and the bytes (ADR-0098 decision 9), without a database.

import { describe, expect, it } from "vitest";
import { attachmentMarkdown, attachmentTypeOf, safeAttachmentName, sniffAttachmentType, uniqueAttachmentName } from "../../src/modules/delivery/wiki/domain/wiki.attachments.js";

const bytes = (...values: number[]): Uint8Array => Uint8Array.from([...values, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

describe("sniffAttachmentType", () => {
  it("knows png, jpeg, gif, webp and pdf by their first bytes", () => {
    expect(sniffAttachmentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffAttachmentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffAttachmentType(bytes(...ascii("GIF89a")))).toBe("image/gif");
    expect(sniffAttachmentType(bytes(...ascii("GIF87a")))).toBe("image/gif");
    expect(sniffAttachmentType(Uint8Array.from([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBPVP8 ")]))).toBe("image/webp");
    expect(sniffAttachmentType(bytes(...ascii("%PDF-1.7")))).toBe("application/pdf");
  });

  it("knows nothing else: SVG, HTML, text, an archive, a wave file, a short file, nothing", () => {
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "<!doctype html><script>alert(1)</script>", "plain text", "PK\u0003\u0004zip"]) {
      expect(sniffAttachmentType(Uint8Array.from(ascii(text))), text).toBeUndefined();
    }
    expect(sniffAttachmentType(Uint8Array.from([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVEfmt ")]))).toBeUndefined();
    expect(sniffAttachmentType(Uint8Array.from([0x89, 0x50]))).toBeUndefined();
    expect(sniffAttachmentType(new Uint8Array())).toBeUndefined();
  });
});

describe("safeAttachmentName", () => {
  it("keeps a safe name, drops folders and any other character, and keeps the extension", () => {
    expect(safeAttachmentName("diagram.png")).toBe("diagram.png");
    expect(safeAttachmentName("C:\\Users\\ada\\Desktop\\Plan v2.PDF")).toBe("Plan-v2.PDF");
    expect(safeAttachmentName("../../etc/passwd.png")).toBe("passwd.png");
    expect(safeAttachmentName("My Diagram (final).png")).toBe("My-Diagram-final.png");
    expect(safeAttachmentName("café ☕.jpg")).toBe("cafe.jpg");
    expect(safeAttachmentName(".hidden.gif")).toBe("hidden.gif");
    expect(safeAttachmentName("two.dots.in.name.webp")).toBe("two.dots.in.name.webp");
  });

  it("refuses an extension that is not allowed, SVG and a double extension included, and a name with nothing left", () => {
    for (const name of ["vector.svg", "page.html", "notes.md", "noextension", "a.png.exe", ".png", "---.png", "☕.png", "", "archive.zip", "script.js"]) {
      expect(safeAttachmentName(name), name).toBeUndefined();
    }
  });

  it("is at most 128 characters, extension kept, and the result is always a name the layout accepts", () => {
    const long = safeAttachmentName(`${"a".repeat(300)}.png`)!;
    expect(long.length).toBe(128);
    expect(long.endsWith(".png")).toBe(true);
  });
});

describe("uniqueAttachmentName", () => {
  it("adds -2, -3… before the extension until the name is free, without regard to case", () => {
    expect(uniqueAttachmentName("a.png", new Set())).toBe("a.png");
    expect(uniqueAttachmentName("a.png", new Set(["a.png"]))).toBe("a-2.png");
    expect(uniqueAttachmentName("a.png", new Set(["A.PNG", "a-2.png"]))).toBe("a-3.png");
    expect(uniqueAttachmentName("a.b.png", new Set(["a.b.png"]))).toBe("a.b-2.png");
  });

  it("keeps a long name within 128 characters", () => {
    const long = `${"a".repeat(124)}.png`;
    const next = uniqueAttachmentName(long, new Set([long]));
    expect(next.length).toBeLessThanOrEqual(128);
    expect(next.endsWith("-2.png")).toBe(true);
  });
});

describe("attachmentTypeOf and attachmentMarkdown", () => {
  it("maps an extension to its type and says how to show the file", () => {
    expect(attachmentTypeOf("a.JPG")).toBe("image/jpeg");
    expect(attachmentTypeOf("a.pdf")).toBe("application/pdf");
    expect(attachmentTypeOf("a.svg")).toBeUndefined();
    expect(attachmentTypeOf("noextension")).toBeUndefined();
    expect(attachmentMarkdown("a.png", "image/png")).toBe("![a.png](_attachments/a.png)");
    expect(attachmentMarkdown("plan.pdf", "application/pdf")).toBe("[plan.pdf](_attachments/plan.pdf)");
  });
});
