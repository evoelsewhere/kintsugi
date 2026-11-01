import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Select } from "./select";

describe("Select", () => {
  it("is a combobox that pops up a listbox, closed until opened", () => {
    const html = renderToStaticMarkup(<Select value="b" options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Bravo" }]} onChange={() => undefined} />);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Bravo");
    expect(html).not.toContain("aria-activedescendant");
  });
});
