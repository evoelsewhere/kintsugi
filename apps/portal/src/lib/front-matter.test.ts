import { describe, expect, it } from "vitest";
import { splitFrontMatter } from "./front-matter";

describe("front matter", () => {
  it("splits JSON scalars and block lists from the text", () => {
    const { fields, body } = splitFrontMatter('---\napp: "billing"\nitems: 12\nok: true\nlanguages:\n  - "Java"\n  - "SQL"\nempty: []\n---\n# Title\n\ntext');
    expect(fields).toEqual([
      ["app", "billing"],
      ["items", "12"],
      ["ok", "true"],
      ["languages", "Java, SQL"],
      ["empty", ""],
    ]);
    expect(body).toBe("# Title\n\ntext");
  });

  it("leaves a document without front matter, or with an unterminated block, as it is", () => {
    expect(splitFrontMatter("# Title\n")).toEqual({ fields: [], body: "# Title\n" });
    expect(splitFrontMatter("---\na: 1\n# no end")).toEqual({ fields: [], body: "---\na: 1\n# no end" });
  });
});
