// Moving pages without breaking a link (P2-031, ADR-0098 decision 5): the plan of a move is pure, so the cases that decide
// the exit "a move rewrites every inbound link" are tested without Git, and a seeded property test checks the plan against
// the Brain's own link resolution.

import { describe, expect, it } from "vitest";
import { buildBrainTree } from "../src/brain.js";
import { type PageFile, type PageMovePlan, planMove, withoutOrderEntry } from "../src/page-move.js";

const textOf = (plan: PageMovePlan, path: string): string | undefined => ("entries" in plan ? plan.entries.find((entry) => entry.path === path)?.text : undefined);
const must = (plan: PageMovePlan): Extract<PageMovePlan, { entries: unknown }> => {
  if (!("entries" in plan)) throw new Error(`refused: ${plan.error} ${plan.path}`);
  return plan;
};

describe("planMove: links into a page that moves", () => {
  const files: PageFile[] = [
    { path: "a/a.md", text: "# A\n\nSee [the page](../b/c.md) and [its setup](../b/c.md#setup), or [again](<../b/c.md#usage> \"a title\").\n" },
    { path: "b/c.md", text: "# C\n\n## Setup\n\n## Usage\n" },
  ];

  it("rewrites every inbound link, keeping the text, the fragment, the title and the angle form", () => {
    const plan = must(planMove({ moves: [{ from: "b/c.md", to: "d/c.md" }], files }));
    expect(textOf(plan, "a/a.md")).toBe("# A\n\nSee [the page](../d/c.md) and [its setup](../d/c.md#setup), or [again](<../d/c.md#usage> \"a title\").\n");
    expect(plan.rewrittenLinks).toBe(3);
    expect(plan.entries.map((entry) => [entry.path, entry.renameFrom])).toEqual([["d/c.md", "b/c.md"], ["a/a.md", undefined]]);
    expect(plan.touched).toEqual(["a/a.md", "b/c.md", "d/c.md"]);
  });

  it("returns no entry for a page whose text did not change", () => {
    const plan = must(planMove({ moves: [{ from: "b/c.md", to: "d/c.md" }], files: [...files, { path: "x/x.md", text: "# X\n\n[elsewhere](../y/y.md) and [web](https://example.com/b/c.md) and [here](#top)\n" }] }));
    expect(plan.entries.map((entry) => entry.path)).toEqual(["d/c.md", "a/a.md"]);
  });

  it("renames in place: a link to a page in its own folder follows the new name", () => {
    const plan = must(planMove({ moves: [{ from: "b/c.md", to: "b/renamed.md" }], files }));
    expect(textOf(plan, "a/a.md")).toContain("[the page](../b/renamed.md)");
    expect(textOf(plan, "a/a.md")).toContain("[its setup](../b/renamed.md#setup)");
  });

  it("does not touch links in code fences or inline code, nor external, anchor-only and unmoved ones", () => {
    const text = [
      "# A",
      "",
      "Inline `[x](../b/c.md)` and ``[y](../b/c.md)`` stay; [real](../b/c.md) moves.",
      "",
      "```md",
      "[fenced](../b/c.md)",
      "```",
      "",
      "~~~",
      "[tilde](../b/c.md)",
      "~~~",
      "",
      "[web](https://example.com/b/c.md) [top](#top) [other](../b/other.md) [mail](mailto:x@y.z) [image](../b/c.md)",
      "",
    ].join("\n");
    const plan = must(planMove({ moves: [{ from: "b/c.md", to: "d/c.md" }], files: [{ path: "a/a.md", text }, files[1] as PageFile] }));
    const out = textOf(plan, "a/a.md") ?? "";
    expect(out).toContain("`[x](../b/c.md)` and ``[y](../b/c.md)``");
    expect(out).toContain("[real](../d/c.md) moves");
    expect(out).toContain("[fenced](../b/c.md)");
    expect(out).toContain("[tilde](../b/c.md)");
    expect(out).toContain("[web](https://example.com/b/c.md) [top](#top) [other](../b/other.md) [mail](mailto:x@y.z)");
    expect(plan.rewrittenLinks).toBe(2);
  });

  it("keeps CRLF endings, a missing final newline and the front matter", () => {
    const text = "---\ntitle: A\nlink: ../b/c.md\n---\n\r\nSee [c](../b/c.md)";
    const plan = must(planMove({ moves: [{ from: "b/c.md", to: "d/c.md" }], files: [{ path: "a/a.md", text }, files[1] as PageFile] }));
    expect(textOf(plan, "a/a.md")).toBe("---\ntitle: A\nlink: ../b/c.md\n---\n\r\nSee [c](../d/c.md)");
  });

  it("writes an escaped target the way the original wrote it", () => {
    const spaced: PageFile[] = [
      { path: "a/a.md", text: "[bare](../b/my%20page.md) and [angle](<../b/my page.md>)\n" },
      { path: "b/my page.md", text: "# My page\n" },
    ];
    const plan = must(planMove({ moves: [{ from: "b/my page.md", to: "d/our page.md" }], files: spaced }));
    expect(textOf(plan, "a/a.md")).toBe("[bare](../d/our%20page.md) and [angle](<../d/our page.md>)\n");
  });
});

describe("planMove: the links of the page that moves", () => {
  it("rewrites its outgoing links for its new folder, and keeps an absolute link where it points", () => {
    const files: PageFile[] = [
      { path: "b/c.md", text: "# C\n\nUp [x](../x.md), side [y](y.md#h), down [z](sub/z.md), folder [f](../f/), root [r](/00-project/r.md), self [me](c.md#h), image ![i](_attachments/i.png)\n" },
    ];
    const plan = must(planMove({ moves: [{ from: "b/c.md", to: "d/e/c.md" }], files }));
    expect(textOf(plan, "d/e/c.md")).toBe("# C\n\nUp [x](../../x.md), side [y](../../b/y.md#h), down [z](../../b/sub/z.md), folder [f](../../f/), root [r](/00-project/r.md), self [me](c.md#h), image ![i](../../b/_attachments/i.png)\n");
  });

  it("points links between pages that move together at the new places", () => {
    const files: PageFile[] = [
      { path: "b/one.md", text: "[two](two.md) and [out](../out.md)\n" },
      { path: "b/two.md", text: "[one](one.md#top)\n" },
    ];
    const plan = must(planMove({ moves: [{ from: "b/one.md", to: "n/one.md" }, { from: "b/two.md", to: "m/two.md" }], files }));
    expect(textOf(plan, "n/one.md")).toBe("[two](../m/two.md) and [out](../out.md)\n");
    expect(textOf(plan, "m/two.md")).toBe("[one](../n/one.md#top)\n");
  });

  it("does not mention a moved page that only keeps its own links", () => {
    const plan = must(planMove({ moves: [{ from: "b/c.md", to: "b/d.md" }], files: [{ path: "b/c.md", text: "# C\n\n[x](../x.md) and [y](y.md)\n" }] }));
    expect(plan.entries).toEqual([{ path: "b/d.md", renameFrom: "b/c.md", text: "# C\n\n[x](../x.md) and [y](y.md)\n" }]);
    expect(plan.rewrittenLinks).toBe(0);
  });
});

describe("planMove: order lists", () => {
  const page = (order: string): string => `---\ntitle: Space\n${order}---\n\n# Space\n`;

  it("removes the page from the old home page's order and appends it to the new one, only where an order exists", () => {
    const files: PageFile[] = [
      { path: "s/old/README.md", text: page("order:\n  - first\n  - c\n  - last\n") },
      { path: "s/new/README.md", text: page("order: [one, two]\n") },
      { path: "s/old/c.md", text: "# C\n" },
    ];
    const plan = must(planMove({ moves: [{ from: "s/old/c.md", to: "s/new/c.md" }], files }));
    expect(textOf(plan, "s/old/README.md")).toBe(page("order:\n  - first\n  - last\n"));
    expect(textOf(plan, "s/new/README.md")).toBe(page("order: [one, two, c]\n"));
  });

  it("matches the name with or without .md, appends a block item with the indentation of the list, and creates no order", () => {
    const files: PageFile[] = [
      { path: "s/old/index.md", text: page("order:\n    - c.md\n    - d\n") },
      { path: "s/new/README.md", text: page("order:\n    - one\n") },
      { path: "s/old/c.md", text: "# C\n" },
      { path: "t/README.md", text: page("") },
    ];
    const plan = must(planMove({ moves: [{ from: "s/old/c.md", to: "s/new/c.md" }], files }));
    expect(textOf(plan, "s/old/index.md")).toBe(page("order:\n    - d\n"));
    expect(textOf(plan, "s/new/README.md")).toBe(page("order:\n    - one\n    - c\n"));
    // A home page without an order is left alone, and so is a folder without a home page.
    const plain = must(planMove({ moves: [{ from: "s/old/c.md", to: "t/c.md" }], files }));
    expect(plain.entries.map((entry) => entry.path)).toEqual(["t/c.md", "s/old/index.md"]);
    expect(textOf(plain, "t/README.md")).toBeUndefined();
    const lonely = must(planMove({ moves: [{ from: "s/old/c.md", to: "nowhere/c.md" }], files }));
    expect(lonely.entries.map((entry) => entry.path)).toEqual(["nowhere/c.md", "s/old/index.md"]);
  });

  it("does not add the name twice", () => {
    const files: PageFile[] = [{ path: "s/new/README.md", text: page("order: [c, one]\n") }, { path: "s/old/c.md", text: "# C\n" }];
    const plan = must(planMove({ moves: [{ from: "s/old/c.md", to: "s/new/c.md" }], files }));
    expect(textOf(plan, "s/new/README.md")).toBeUndefined();
  });
});

describe("planMove: refusals are values", () => {
  const files: PageFile[] = [{ path: "a/a.md", text: "# A\n" }, { path: "b/b.md", text: "# B\n" }, { path: "c/c.md", text: "# C\n" }];
  const refuse = (moves: Array<{ from: string; to: string }>, given = files) => planMove({ moves, files: given });

  it("refuses a target that exists and does not move away, the same path, a chain or a swap, and a missing page", () => {
    expect(refuse([{ from: "a/a.md", to: "b/b.md" }])).toEqual({ error: "target-exists", path: "b/b.md" });
    expect(refuse([{ from: "a/a.md", to: "a/a.md" }])).toEqual({ error: "same-path", path: "a/a.md" });
    expect(refuse([{ from: "a/a.md", to: "b/b.md" }, { from: "b/b.md", to: "a/a.md" }])).toEqual({ error: "cycle", path: "b/b.md" });
    expect(refuse([{ from: "a/a.md", to: "x.md" }, { from: "x.md", to: "y.md" }], [...files, { path: "x.md", text: "" }])).toEqual({ error: "cycle", path: "x.md" });
    expect(refuse([{ from: "nope/n.md", to: "z/z.md" }])).toEqual({ error: "missing-source", path: "nope/n.md" });
    expect(refuse([{ from: "a/a.md", to: "z/z.md" }, { from: "a/a.md", to: "y/y.md" }])).toEqual({ error: "duplicate-source", path: "a/a.md" });
    expect(refuse([{ from: "a/a.md", to: "z/z.md" }, { from: "b/b.md", to: "z/z.md" }])).toEqual({ error: "target-exists", path: "z/z.md" });
  });

  it("refuses paths the wiki may not write and anything that is not a page", () => {
    for (const to of ["plugins/p/a.md", "restricted/a.md", "scratch/x/a.md", "a/_generated/a.md", ".hidden/a.md", "a/a.txt", "a/_attachments/a.png", "10-applications/billing/01-legacy/a.md"]) {
      expect(refuse([{ from: "a/a.md", to }]), to).toEqual({ error: "outside-wiki", path: to });
    }
    expect(refuse([{ from: "plugins/p/a.md", to: "a/z.md" }], [{ path: "plugins/p/a.md", text: "" }])).toEqual({ error: "outside-wiki", path: "plugins/p/a.md" });
  });
});

// ---- Property test --------------------------------------------------------------------------------------------------

/** A small deterministic generator (mulberry32), so a failing round can be replayed from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

function relative(from: string, to: string): string {
  const base = from.split("/").slice(0, -1);
  const target = to.split("/");
  let common = 0;
  while (common < base.length && common < target.length - 1 && base[common] === target[common]) common += 1;
  return [...base.slice(common).map(() => ".."), ...target.slice(common)].join("/");
}

const ROUNDS = 250;

describe("planMove property test", () => {
  const FOLDERS = ["alpha", "beta", "gamma", "alpha/deep", "beta/deep/er"];

  it(`keeps every link and every broken link as it was, checked with the Brain's own resolution, in ${ROUNDS} random trees`, () => {
    let moved = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      const seed = 9000 + round;
      const rng = random(seed);
      const paths = new Set<string>();
      for (let n = 3 + Math.floor(rng() * 12); n > 0; n -= 1) paths.add(`${pick(rng, FOLDERS)}/p${Math.floor(rng() * 40)}.md`);
      const list = [...paths].sort();
      const HEADINGS = ["setup", "usage", "notes"];
      const files: PageFile[] = list.map((path) => {
        const links = Array.from({ length: Math.floor(rng() * 6) }, () => {
          if (rng() < 0.2) return `[gone](${relative(path, `missing/m${Math.floor(rng() * 5)}.md`)})`;
          const target = pick(rng, list);
          const heading = rng() < 0.5 ? `#${pick(rng, HEADINGS)}` : "";
          const form = relative(path, target) + heading;
          return rng() < 0.2 ? `[link](<${form}> "title")` : `[link](${form})`;
        });
        const front = rng() < 0.2 ? `---\ntitle: ${path}\n---\n\n` : "";
        return { path, text: `${front}# Page\n\n${HEADINGS.map((heading) => `## ${heading[0]?.toUpperCase()}${heading.slice(1)}\n\n${links.splice(0, 2).join(" and ")}\n`).join("\n")}\n${links.join("\n")}\n` };
      });
      const before = buildBrainTree(files, "docs");
      const from = pick(rng, list);
      const to = `${pick(rng, [...FOLDERS, "delta", "alpha/new"])}/n${Math.floor(rng() * 40)}.md`;
      if (paths.has(to)) continue;
      const plan = planMove({ moves: [{ from, to }], files });
      if (!("entries" in plan)) throw new Error(`seed ${seed}: refused ${JSON.stringify(plan)}`);
      moved += 1;

      const map = (path: string): string => (path === from ? to : path);
      const written = new Map(files.map((file) => [map(file.path), file.text]));
      for (const entry of plan.entries) written.set(entry.path, entry.text);
      const after = buildBrainTree([...written].map(([path, text]) => ({ path, text })), "docs");

      const mapId = (id: string): string => {
        const hash = id.indexOf("#");
        return hash < 0 ? map(id) : `${map(id.slice(0, hash))}${id.slice(hash)}`;
      };
      const edges = (tree: typeof before, transform: (id: string) => string): string[] => tree.links.map((link) => `${transform(link.fromId)} -> ${transform(link.toId)}`).sort();
      expect(edges(after, (id) => id), `seed ${seed}`).toEqual(edges(before, mapId));
      const broken = (tree: typeof before, transform: (path: string) => string): string[] => tree.broken.map((entry) => `${transform(entry.from)} -> ${entry.target}`).sort();
      expect(broken(after, (path) => path), `seed ${seed}`).toEqual(broken(before, map));
      // Only pages that link to the moved page or are it were written again.
      for (const entry of plan.entries) {
        if (entry.renameFrom === undefined) expect(files.find((file) => file.path === entry.path)?.text, `seed ${seed}`).not.toBe(entry.text);
      }
    }
    expect(moved).toBeGreaterThan(ROUNDS / 2);
  }, 60_000);
});

describe("withoutOrderEntry", () => {
  const page = (order: string): string => `---\ntitle: Space\n${order}---\n\n# Space\n`;

  it("drops the page from a block or an inline order, with or without .md, and keeps every other byte", () => {
    expect(withoutOrderEntry(page("order:\n  - first\n  - c\n  - last\n"), "c.md")).toBe(page("order:\n  - first\n  - last\n"));
    expect(withoutOrderEntry(page("order:\n  - first\n  - c.md\n"), "c.md")).toBe(page("order:\n  - first\n"));
    expect(withoutOrderEntry(page("order: [one, c, two]\n"), "c.md")).toBe(page("order: [one, two]\n"));
  });

  it("leaves a home page without an order, or without the page in it, exactly as it was", () => {
    const without = page("");
    expect(withoutOrderEntry(without, "c.md")).toBe(without);
    const other = page("order: [one, two]\n");
    expect(withoutOrderEntry(other, "c.md")).toBe(other);
    expect(withoutOrderEntry("# No front matter\n", "c.md")).toBe("# No front matter\n");
  });
});
