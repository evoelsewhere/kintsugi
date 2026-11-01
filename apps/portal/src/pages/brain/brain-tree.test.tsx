import type { BrainNode } from "@kintsugi/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BrainTree } from "./brain-tree";

const api = vi.hoisted(() => ({ tree: vi.fn(() => new Promise(() => undefined)) }));
vi.mock("@/lib/api/brain", () => ({ brainApi: api }));

describe("the Brain tree", () => {
  it("is one Tab stop: only one row takes focus from Tab", () => {
    const root = { id: "root", kind: "root", title: "Billing QA", summary: "", children: 3, subtreeTokens: 0, changed: null } as unknown as BrainNode;
    const html = renderToStaticMarkup(<BrainTree projectId="billing-qa" root={root} selected="root" reveal={[]} showSummaries={false} onSelect={() => undefined} />);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('role="tree"');
  });
});
