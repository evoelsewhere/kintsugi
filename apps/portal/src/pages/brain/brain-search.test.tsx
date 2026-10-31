import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BrainSearch } from "./brain-search";

const api = vi.hoisted(() => ({ grep: vi.fn(), lookup: vi.fn() }));
vi.mock("@/lib/api/brain", () => ({ brainApi: api }));

describe("the Brain search", () => {
  it("asks for a longer query instead of searching for one character", () => {
    const html = renderToStaticMarkup(<BrainSearch projectId="billing-qa" version="v1" text="a" selected="" onSelect={() => undefined} />);
    expect(html).toContain("Type at least 2 characters to search the Brain.");
    expect(html).not.toContain("Could not load");
    expect(html).not.toContain("Retry");
    expect(api.grep).not.toHaveBeenCalled();
    expect(api.lookup).not.toHaveBeenCalled();
  });
});
