// A skill's supporting files are written into the job inputs and named in the definition, never carried in it.

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeReadOnly, makeWritable } from "@kintsugi/runtime/launcher";
import type { AgentDefinition } from "@kintsugi/runtime-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { materializeSkillFiles } from "../src/jobs/skill-files.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) {
    await makeWritable(dir);
    await rm(dir, { recursive: true, force: true });
  }
  dir = undefined;
});

const definition = (files?: Record<string, string>): AgentDefinition => ({
  id: "a",
  version: "1",
  instructions: "x",
  tools: [],
  skills: [{ name: "diagrams", content: "body", ...(files === undefined ? {} : { files }) }, { name: "plain", content: "body" }],
});

describe("materializeSkillFiles", () => {
  it("writes the files under the inputs and replaces them with their directory and paths", async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-files-"));
    const result = await materializeSkillFiles(definition({ "references/b.md": "B", "references/a.md": "A", "../escape.md": "no" }), dir);
    const skill = result.skills![0]!;
    expect(skill.files).toBeUndefined();
    expect(skill.supporting).toEqual({ dir: join(dir, ".skills", "diagrams"), paths: ["references/a.md", "references/b.md"] });
    expect(await readFile(join(dir, ".skills", "diagrams", "references", "a.md"), "utf8")).toBe("A");
    expect(result.skills![1]).toEqual({ name: "plain", content: "body" });
  });

  it("materializes skill files in read-only inputs and locks them again", async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-files-"));
    await makeReadOnly(dir);

    const result = await materializeSkillFiles(definition({ "references/a.md": "A" }), dir);

    expect(await readFile(join(dir, ".skills", "diagrams", "references", "a.md"), "utf8")).toBe("A");
    expect(result.skills![0]!.supporting?.paths).toEqual(["references/a.md"]);
    if (process.platform !== "win32") {
      expect((await stat(dir)).mode & 0o222).toBe(0);
    }
  });

  it("returns a definition without skill files unchanged", async () => {
    const original = definition();
    expect(await materializeSkillFiles(original, "unused")).toBe(original);
  });
});
