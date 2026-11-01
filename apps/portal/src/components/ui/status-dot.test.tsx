import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusDot } from "./status-dot";

describe("StatusDot", () => {
  it("draws the busy spinner with longhand border colours only, so a tone change keeps its open side", () => {
    const html = renderToStaticMarkup(<StatusDot tone="blue" busy="spin" />);
    expect(html).toContain("border-right-color:transparent");
    expect(html).toContain("border-top-color:");
    expect(html).not.toMatch(/border-color:/);
  });
});
