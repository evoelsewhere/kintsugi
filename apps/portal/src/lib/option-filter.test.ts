import { describe, expect, it } from "vitest";
import { filterOptions } from "./option-filter";

const options = [
  { value: "mimo-v2.6-flash", label: "mimo-v2.6-flash", hint: "MiMo Flash" },
  { value: "mimo-v2.5-pro", label: "mimo-v2.5-pro" },
  { value: "billing", label: "Billing QA", hint: "billing-qa" },
];

describe("filterOptions", () => {
  it("keeps every option for an empty query", () => {
    expect(filterOptions(options, "  ")).toEqual(options);
  });

  it("matches every word against the label, value and hint, ignoring case and order", () => {
    expect(filterOptions(options, "FLASH").map((option) => option.value)).toEqual(["mimo-v2.6-flash"]);
    expect(filterOptions(options, "pro mimo").map((option) => option.value)).toEqual(["mimo-v2.5-pro"]);
    expect(filterOptions(options, "qa").map((option) => option.value)).toEqual(["billing"]);
    expect(filterOptions(options, "mimo ultra")).toEqual([]);
  });
});
