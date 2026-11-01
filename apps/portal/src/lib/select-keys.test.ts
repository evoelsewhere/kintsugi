import { describe, expect, it } from "vitest";
import { openingOption, optionAfterKey } from "./select-keys";

const options = [{ label: "Alpha" }, { label: "Beta", disabled: true }, { label: "Bravo" }, { label: "Charlie" }];

describe("the Select's keyboard", () => {
  it("opens on the selected option, or on the first that can be chosen", () => {
    expect(openingOption(options, 2)).toBe(2);
    expect(openingOption(options, -1)).toBe(0);
    expect(openingOption(options, 1)).toBe(0);
    expect(openingOption([{ label: "x", disabled: true }, { label: "y" }], -1)).toBe(1);
  });

  it("moves with the arrows, skipping disabled options and stopping at the ends", () => {
    expect(optionAfterKey(options, 0, "ArrowDown")).toBe(2);
    expect(optionAfterKey(options, 2, "ArrowUp")).toBe(0);
    expect(optionAfterKey(options, 3, "ArrowDown")).toBe(3);
    expect(optionAfterKey(options, 0, "ArrowUp")).toBe(0);
  });

  it("jumps to the first and the last option with Home and End", () => {
    expect(optionAfterKey(options, 2, "Home")).toBe(0);
    expect(optionAfterKey(options, 0, "End")).toBe(3);
  });

  it("jumps to the next option starting with a typed character, wrapping around", () => {
    expect(optionAfterKey(options, 0, "b")).toBe(2);
    expect(optionAfterKey(options, 2, "B")).toBe(2);
    expect(optionAfterKey(options, 3, "a")).toBe(0);
    expect(optionAfterKey(options, 0, "z")).toBe(0);
  });

  it("ignores other keys", () => {
    expect(optionAfterKey(options, 2, " ")).toBe(2);
    expect(optionAfterKey(options, 2, "Shift")).toBe(2);
  });
});
