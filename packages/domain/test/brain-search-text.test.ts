// What the text index of a node is made of (P4-001, builder 7): the title, the headings under it with the labels and id of
// its page, and its own lines, never those of its children.

import { describe, expect, it } from "vitest";
import { BRAIN_BUILDER_VERSION, BRAIN_SEARCH_BODY_MAX, brainDocumentPart } from "../src/brain.js";

const PAGE = "---\nid: PAGE-ENG-0001\nlabels: [Billing, sev1]\n---\n\n# Gateway\n\nIntro words.\n\n## Setup\n\nInstall it.\n\n### Tokens\n\nKeep them secret.\n\n## RULE-PAY-0001: Late fee\n\n- the fee is due\n\n```sh\nchargeCustomer()\n```\n";

describe("the text of a node for the index", () => {
  const part = brainDocumentPart({ path: "20-spaces/eng/gateway.md", text: PAGE });
  const text = (id: string) => part.search.find((entry) => entry.nodeId === id);

  it("is builder 7, with a text for the document and for each section and card", () => {
    expect(BRAIN_BUILDER_VERSION).toBe(7);
    expect(part.search.map((entry) => entry.nodeId)).toEqual(part.nodes.map((node) => node.id));
  });

  it("gives a document its title, its labels, its id and all the headings of its page, and its own lines before the first heading", () => {
    expect(text("20-spaces/eng/gateway.md")).toEqual({
      nodeId: "20-spaces/eng/gateway.md",
      title: "Gateway",
      headings: "billing sev1 PAGE-ENG-0001 Setup Tokens RULE-PAY-0001: Late fee",
      body: "\nIntro words.\n",
    });
  });

  it("gives a section its own lines and the headings directly under it, not the lines of its children", () => {
    const setup = text("20-spaces/eng/gateway.md#setup");
    expect(setup?.title).toBe("Setup");
    expect(setup?.headings).toBe("Tokens");
    expect(setup?.body).toContain("Install it.");
    expect(setup?.body).not.toContain("secret");
    expect(text("20-spaces/eng/gateway.md#tokens")?.body).toContain("Keep them secret.");
  });

  it("keeps the code of a card and its fields", () => {
    const card = text("20-spaces/eng/gateway.md#RULE-PAY-0001");
    expect(card?.title).toBe("RULE-PAY-0001: Late fee");
    expect(card?.body).toContain("the fee is due");
    expect(card?.body).toContain("chargeCustomer()");
  });

  it("takes no NUL and at most BRAIN_SEARCH_BODY_MAX characters of a node's lines", () => {
    const long = brainDocumentPart({ path: "a.md", text: `# A\n\n${"word ".repeat(200_000)}\0end\n` });
    const body = long.search[0]?.body ?? "";
    expect(body.length).toBeLessThanOrEqual(BRAIN_SEARCH_BODY_MAX);
    expect(body).not.toContain("\0");
    const withNul = brainDocumentPart({ path: "b.md", text: "# B\n\nbefore\0after\n" });
    expect(withNul.search[0]?.body).toContain("before after");
  });
});
