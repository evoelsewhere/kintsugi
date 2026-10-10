import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PathGuard, isInside } from "../src/kernel/paths.js";
import { createWorkspace } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

describe("isInside", () => {
  it("accepts the root and its descendants", () => {
    expect(isInside(workspace.src, workspace.src)).toBe(true);
    expect(isInside(workspace.src, join(workspace.src, "a", "b.txt"))).toBe(true);
  });

  it("rejects siblings, parents and prefix look-alikes", () => {
    expect(isInside(workspace.src, workspace.root)).toBe(false);
    expect(isInside(workspace.src, workspace.outside)).toBe(false);
    expect(isInside(workspace.src, `${workspace.src}-evil`)).toBe(false);
  });
});

describe("PathGuard", () => {
  const guard = new PathGuard([workspace.src]);

  it("allows existing and not-yet-created paths inside a root", () => {
    expect(() => guard.check(join(workspace.src, "hello.txt"))).not.toThrow();
    expect(() => guard.check(join(workspace.src, "new", "file.md"))).not.toThrow();
  });

  it("rejects absolute and relative escapes", () => {
    expect(() => guard.check(join(workspace.outside, "token.txt"))).toThrow(/outside the job workspace/);
    expect(() => guard.check(join(workspace.src, "..", "outside", "token.txt"))).toThrow(/outside the job workspace/);
  });

  it("rejects symlinks that point outside", (context) => {
    const link = join(workspace.src, "escape");
    try {
      symlinkSync(workspace.outside, link, "junction");
    } catch {
      context.skip(); // symlinks need extra privileges on some Windows setups
    }
    expect(() => guard.check(join(link, "token.txt"))).toThrow(/outside the job workspace/);
  });

  it("accepts several roots", () => {
    const other = join(workspace.root, "other");
    mkdirSync(other);
    const multi = new PathGuard([workspace.src, other]);
    expect(() => multi.check(join(other, "x.txt"))).not.toThrow();
    expect(() => multi.check(join(workspace.outside, "x.txt"))).toThrow();
  });
});
