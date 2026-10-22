import { describe, expect, it } from "vitest";
import { parseSourceSpec, sourceFolder, sourcePath, sourceSpec, splitSourcePath } from "../src/source.js";

const A = "a".repeat(40);
const B = "b".repeat(40);

describe("source repositories of a run (ADR-0052)", () => {
  it("writes and reads a spec, in order", () => {
    const spec = sourceSpec([
      { repositoryId: "falo-skeleton", commit: A },
      { repositoryId: "falo-unities", commit: B },
    ]);
    expect(spec).toBe(`falo-skeleton@${A},falo-unities@${B}`);
    expect(parseSourceSpec(spec)).toEqual([
      { repositoryId: "falo-skeleton", commit: A },
      { repositoryId: "falo-unities", commit: B },
    ]);
  });

  it("refuses a source without a commit and a spec that is not well formed", () => {
    expect(() => sourceSpec([{ repositoryId: "web" }])).toThrow(/no commit/);
    for (const bad of ["", "web", `web@${A}@x`, `web@nothex`, `../x@${A}`, `web@${A},web@${B}`, `web@${A},`]) expect(parseSourceSpec(bad), bad).toBeUndefined();
  });

  it("names the mount folder by the repository id and refuses an id that is not one segment", () => {
    expect(sourceFolder("web-legacy")).toBe("web-legacy");
    for (const bad of ["", ".hidden", "a/b", "..", "a b"]) expect(() => sourceFolder(bad), bad).toThrow();
    expect(sourcePath("web", "src/Main.java")).toBe("web/src/Main.java");
  });

  it("splits a cited path by its repository", () => {
    const sources = [{ repositoryId: "web" }, { repositoryId: "db" }];
    expect(splitSourcePath("db/schema/a.sql", sources)).toEqual({ repositoryId: "db", path: "schema/a.sql" });
    expect(splitSourcePath("other/a.sql", sources)).toBeUndefined();
    expect(splitSourcePath("a.sql", sources)).toBeUndefined();
  });
});
