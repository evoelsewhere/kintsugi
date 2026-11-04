import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadMarkdown, exportFileName } from "./wiki-export";

describe("exportFileName", () => {
  it("is the last segment of the path, ending .md", () => {
    expect(exportFileName("20-spaces/team/db.md")).toBe("db.md");
    expect(exportFileName("README.md")).toBe("README.md");
    expect(exportFileName("notes/Runbook.MD")).toBe("Runbook.md");
    expect(exportFileName("notes/plain")).toBe("plain.md");
  });

  it("turns anything outside letters, digits, dot, dash and underscore into an underscore", () => {
    expect(exportFileName("a/my notes (v2).md")).toBe("my_notes__v2_.md");
    expect(exportFileName('a/q"uote<>.md')).toBe("q_uote__.md");
    expect(exportFileName("a/tài liệu.md")).toBe("t_i_li_u.md");
    expect(exportFileName("a\\b\\c:d.md")).toBe("c_d.md");
  });

  it("never gives a hidden file, a path or an empty name", () => {
    expect(exportFileName("a/.hidden.md")).toBe("_hidden.md");
    expect(exportFileName("a/..md")).toBe("page.md");
    expect(exportFileName("../../etc/passwd")).toBe("passwd.md");
    expect(exportFileName("")).toBe("page.md");
    expect(exportFileName("folder/")).toBe("folder.md");
    expect(exportFileName("/")).toBe("page.md");
  });
});

describe("downloadMarkdown", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves the text as a Markdown file and releases the temporary address", async () => {
    const clicked: Array<{ href: string; download: string }> = [];
    const body = { append: vi.fn() };
    const link = { href: "", download: "", rel: "", style: { display: "" }, click: vi.fn(() => clicked.push({ href: link.href, download: link.download })), remove: vi.fn() };
    let blob: Blob | undefined;
    const createObjectURL = vi.fn((made: Blob) => {
      blob = made;
      return "blob:kintsugi/1";
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("document", { createElement: vi.fn(() => link), body });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const text = "# Tiêu đề\r\n\r\nline\n\ttab\n";
    downloadMarkdown("db.md", text);

    expect(clicked).toEqual([{ href: "blob:kintsugi/1", download: "db.md" }]);
    expect(blob?.type).toBe("text/markdown;charset=utf-8");
    expect(await blob?.text()).toBe(text);
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new TextEncoder().encode(text));
    expect(link.remove).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:kintsugi/1");
  });

  it("releases the address even when the click throws", () => {
    const link = { href: "", download: "", rel: "", style: { display: "" }, click: vi.fn(() => { throw new Error("blocked"); }), remove: vi.fn() };
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("document", { createElement: vi.fn(() => link), body: { append: vi.fn() } });
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL });
    expect(() => downloadMarkdown("a.md", "x")).toThrow("blocked");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });
});
