// The data view of the understand results: the data objects (rules results), the data stores (topology) and which
// units read and write them (traceability matrix), joined by name, and the Mermaid diagrams drawn from that: the
// lineage (who writes and reads each store) and the model (an entity-relationship diagram of the objects). Pure, so
// the joins and the diagrams are tested without a browser. Relations are inferred, never read: nothing the
// understand stage writes states a key, so a field named after another object (CUSTOMER_ID → CUSTOMER) is the only hint.

import type { CatalogRule, DataObject, MapNode, TopoEdge, UnderstandUnit } from "./api/documents";

const WRITE = /write|update|insert|delete|create|put|save|store/i;

export interface ObjectUse {
  object: DataObject;
  /** The rules that read or write it (matched by name; a name cut short with … matches by prefix). */
  rules: CatalogRule[];
  units: UnderstandUnit[];
}

export interface StoreUse {
  id: string;
  name: string;
  kind: string;
  readers: UnderstandUnit[];
  writers: UnderstandUnit[];
  /** The topology nodes (programs) with an edge to the store, by name: what is known before any unit is understood. */
  programs: { readers: string[]; writers: string[] };
}

const key = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export function objectUses(objects: readonly DataObject[], rules: readonly CatalogRule[], units: readonly UnderstandUnit[]): ObjectUse[] {
  return objects.map((object) => {
    const wanted = key(object.name);
    return {
      object,
      rules: object.consumedBy.flatMap((name) => rules.find((rule) => rule.name === name || (name.endsWith("…") && rule.name.startsWith(name.slice(0, -1)))) ?? []),
      units: units.filter((unit) => unit.dataObjects.some((name) => key(name) === wanted)),
    };
  });
}

export function storeUses(nodes: readonly MapNode[], units: readonly UnderstandUnit[], edges: readonly TopoEdge[] = []): StoreUse[] {
  const stores = new Map<string, StoreUse>();
  for (const node of nodes) if (node.kind === "datastore") stores.set(key(node.id), { id: node.id, name: node.name, kind: node.kind, readers: [], writers: [], programs: { readers: [], writers: [] } });
  const byName = new Map([...stores.values()].map((store) => [key(store.name), store]));
  const names = new Map(nodes.map((node) => [node.id, node.name]));
  for (const edge of edges) {
    const store = stores.get(key(edge.target));
    if (store === undefined) continue;
    const name = names.get(edge.source) ?? edge.source;
    const list = edge.kind === "write" ? store.programs.writers : store.programs.readers;
    if (!list.includes(name)) list.push(name);
  }
  for (const unit of units) {
    for (const access of unit.dataStores) {
      let store = stores.get(key(access.id)) ?? byName.get(key(access.id));
      if (store === undefined) {
        store = { id: access.id, name: access.id, kind: "datastore", readers: [], writers: [], programs: { readers: [], writers: [] } };
        stores.set(key(access.id), store);
      }
      const writes = access.access.some((kind) => WRITE.test(kind));
      if (writes) store.writers.push(unit);
      if (!writes || access.access.some((kind) => !WRITE.test(kind))) store.readers.push(unit);
    }
  }
  return [...stores.values()].sort((a, b) => b.readers.length + b.writers.length - (a.readers.length + a.writers.length) || a.name.localeCompare(b.name));
}

const label = (text: string, max = 40): string => {
  const clean = text.replace(/["\n\r<>|]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const MAX_STORES = 25;
const MAX_UNITS_PER_STORE = 8;

/** Units → stores they write and stores → units that read them, as a left-to-right flowchart; undefined when no unit touches a store. */
export function lineageDiagram(stores: readonly StoreUse[]): string | undefined {
  const touched = stores.filter((store) => store.readers.length + store.writers.length > 0).slice(0, MAX_STORES);
  if (touched.length === 0) return undefined;
  const lines = ["flowchart LR"];
  const units = new Map<string, string>();
  const edges: string[] = [];
  const unitId = (unit: UnderstandUnit): string => {
    let id = units.get(unit.key);
    if (id === undefined) {
      id = `u${units.size}`;
      units.set(unit.key, id);
      lines.push(`  ${id}["${label(unit.title || unit.key)}"]`);
    }
    return id;
  };
  touched.forEach((store, index) => {
    lines.push(`  s${index}[("${label(store.name)}")]`);
    for (const unit of store.writers.slice(0, MAX_UNITS_PER_STORE)) edges.push(`  ${unitId(unit)} -->|write| s${index}`);
    for (const unit of store.readers.filter((reader) => !store.writers.includes(reader)).slice(0, MAX_UNITS_PER_STORE)) edges.push(`  s${index} -->|read| ${unitId(unit)}`);
  });
  return [...lines, ...edges].join("\n") + "\n";
}

const MAX_ENTITIES = 40;
const MAX_ATTRIBUTES = 12;

const entityName = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1") || "OBJECT";
const typeName = (type: string | undefined): string => (type ?? "").replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "field";
const attributeName = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1") || "field";
const stem = (name: string): string => key(name).replace(/(id|key|no|num|number|code)$/, "");

/** An entity-relationship diagram of the data objects (the most consumed first), with a relation where a field is named after another object. */
export function modelDiagram(uses: readonly ObjectUse[]): { source: string; relations: number; shown: number } | undefined {
  const chosen = [...uses].sort((a, b) => b.rules.length + b.units.length - (a.rules.length + a.units.length) || a.object.name.localeCompare(b.object.name)).slice(0, MAX_ENTITIES);
  if (chosen.length === 0) return undefined;
  const names = new Map<string, string>();
  for (const use of chosen) {
    let name = entityName(use.object.name);
    while ([...names.values()].includes(name)) name += "_";
    names.set(use.object.name, name);
  }
  const byKey = new Map(chosen.map((use) => [key(use.object.name), use.object.name]));
  const lines = ["erDiagram"];
  const relations = new Set<string>();
  for (const use of chosen) {
    const self = names.get(use.object.name) ?? "OBJECT";
    lines.push(`  ${self} {`);
    for (const field of use.object.fields.slice(0, MAX_ATTRIBUTES)) lines.push(`    ${typeName(field.type)} ${attributeName(field.name)}`);
    lines.push("  }");
    for (const field of use.object.fields) {
      const target = byKey.get(stem(field.name));
      if (target === undefined || target === use.object.name) continue;
      relations.add(`  ${names.get(target) ?? "OBJECT"} ||--o{ ${self} : "${label(field.name, 30)}"`);
    }
  }
  return { source: [...lines, ...relations].join("\n") + "\n", relations: relations.size, shown: chosen.length };
}
