import { describe, expect, it } from "vitest";
import type { CatalogRule, DataObject, MapNode, UnderstandUnit } from "./api/documents";
import { lineageDiagram, modelDiagram, objectUses, storeUses } from "./data-model";

const objects: DataObject[] = [
  { name: "CUSTOMER", fields: [{ name: "CUSTOMER_ID", type: "CHAR(9)" }, { name: "NAME" }], consumedBy: ["Validate customer"] },
  { name: "ACCOUNT", fields: [{ name: "ACCT_ID" }, { name: "CUSTOMER_ID", type: "CHAR(9)" }], consumedBy: [] },
];
const unit = (key: string, patch: Partial<UnderstandUnit>): UnderstandUnit => ({ id: key, key, module: "m", unit: key, title: key, loc: 1, entryPoint: false, spec: null, files: [], dependsOn: [], usedBy: [], dataStores: [], externalSystems: [], rules: [], findings: [], dataObjects: [], entryPoints: [], openQuestions: 0, ...patch });
const units = [
  unit("m/post", { dataStores: [{ id: "ds:accounts", access: ["write"] }], dataObjects: ["customer"] }),
  unit("m/report", { dataStores: [{ id: "ds:accounts", access: ["read"] }] }),
];
const nodes = [{ id: "ds:accounts", name: "Accounts", kind: "datastore" }] as MapNode[];

describe("the data model", () => {
  it("joins objects to the rules and units that use them", () => {
    const uses = objectUses(objects, [{ id: "RULE-1", name: "Validate customer" }] as CatalogRule[], units);
    expect(uses[0]?.rules.map((rule) => rule.id)).toEqual(["RULE-1"]);
    expect(uses[0]?.units.map((entry) => entry.key)).toEqual(["m/post"]);
    expect(uses[1]?.units).toEqual([]);
  });

  it("tells the writers of a store from its readers", () => {
    const [store] = storeUses(nodes, units);
    expect(store?.name).toBe("Accounts");
    expect(store?.writers.map((entry) => entry.key)).toEqual(["m/post"]);
    expect(store?.readers.map((entry) => entry.key)).toEqual(["m/report"]);
  });

  it("draws the lineage and infers a relation from a field named after an object", () => {
    const lineage = lineageDiagram(storeUses(nodes, units));
    expect(lineage).toContain("-->|write|");
    expect(lineage).toContain("-->|read|");
    expect(lineageDiagram(storeUses(nodes, []))).toBeUndefined();
    const model = modelDiagram(objectUses(objects, [], units));
    expect(model?.source).toContain('CUSTOMER ||--o{ ACCOUNT : "CUSTOMER_ID"');
    expect(model?.relations).toBe(1);
  });
});
