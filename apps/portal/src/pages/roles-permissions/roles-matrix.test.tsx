import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox } from "@/components/ui/checkbox";
import { grantLabel } from "./roles-matrix";

describe("the permission matrix", () => {
  it("names each cell after the permission and the role it grants", () => {
    const html = renderToStaticMarkup(<Checkbox checked onChange={() => undefined} ariaLabel={grantLabel("runs.start", "Developer")} />);
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Grant runs.start to Developer"');
  });

  it("leaves a labelled checkbox named by its label", () => {
    const html = renderToStaticMarkup(<Checkbox checked={false} onChange={() => undefined} label="Reduce motion" />);
    expect(html).not.toContain("aria-label");
    expect(html).toContain("Reduce motion");
  });
});
