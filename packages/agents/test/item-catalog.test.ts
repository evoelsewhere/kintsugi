// The reader has no dependencies, so it repeats the catalog item id pattern of @kintsugi/domain:
// this keeps the two equal (ADR-0033).

import { CATALOG_ITEM_ID_PATTERN } from "@kintsugi/domain";
import { describe, expect, it } from "vitest";
import { ITEM_ID } from "../builtin/plugins/understand/hooks/reader/item-catalog.js";

describe("item id pattern", () => {
  it("is the same in the reader and in the domain", () => {
    expect(ITEM_ID.source).toBe(CATALOG_ITEM_ID_PATTERN.source);
    expect(ITEM_ID.flags).toBe(CATALOG_ITEM_ID_PATTERN.flags);
  });
});
