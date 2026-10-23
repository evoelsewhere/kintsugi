import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mermaid from "mermaid";
import { describe, expect, it } from "vitest";

describe("developer documents workflow diagram", () => {
  it("uses valid Mermaid sequence syntax", async () => {
    const page = await readFile(fileURLToPath(new URL("./developer-documents.tsx", import.meta.url)), "utf8");
    const source = /const FLOW = `([\s\S]*?)`;/u.exec(page)?.[1];

    expect(source).toBeDefined();
    await expect(mermaid.parse(source!)).resolves.toBeTruthy();
  });

  it("explains Codex Desktop package preparation separately from app installation", async () => {
    const page = await readFile(fileURLToPath(new URL("./developer-documents.tsx", import.meta.url)), "utf8");
    expect(page).toContain("--install-mode desktop-ui --harness codex");
    expect(page).toContain("Restart Codex Desktop");
    expect(page).toContain("Plugins → Plugins Directory");
    expect(page).toContain("~/.codex/plugins");
    expect(page).toContain("~/.agents/plugins/marketplace.json");
    expect(page).toContain("real-client pilot");
  });
});
