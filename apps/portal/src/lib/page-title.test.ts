import { describe, expect, it } from "vitest";
import { pageTitle } from "./page-title";

describe("pageTitle", () => {
  it("names the page first, then where it is, then Kintsugi", () => {
    expect(pageTitle(["Administration", "Projects", "billing-qa"])).toBe("billing-qa · Projects · Administration · Kintsugi");
    expect(pageTitle([])).toBe("Kintsugi");
  });
});
