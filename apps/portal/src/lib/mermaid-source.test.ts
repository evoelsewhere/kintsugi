import { describe, expect, it } from "vitest";
import { drawableMermaid } from "./mermaid-source";

describe("drawableMermaid", () => {
  it("writes a semicolon in a sequence message as an entity", () => {
    const source = "sequenceDiagram\n    PGM->>PGM: map EIBAID (CSSTRPFY); admit only ENTER / PF3\n";
    expect(drawableMermaid(source)).toBe("sequenceDiagram\n    PGM->>PGM: map EIBAID (CSSTRPFY)#59; admit only ENTER / PF3\n");
  });

  it("keeps entities that are already there", () => {
    const source = "sequenceDiagram\n    A->>B: one #59; two #quot;x#quot;; three\n";
    expect(drawableMermaid(source)).toBe("sequenceDiagram\n    A->>B: one #59; two #quot;x#quot;#59; three\n");
  });

  it("changes a state diagram only after the colon", () => {
    const source = "stateDiagram-v2\n    A --> B: go; now\n    state A\n";
    expect(drawableMermaid(source)).toBe("stateDiagram-v2\n    A --> B: go#59; now\n    state A\n");
  });

  it("leaves other diagrams and sources without a semicolon alone", () => {
    const flow = "flowchart TD\n    A[x; y] --> B\n";
    expect(drawableMermaid(flow)).toBe(flow);
    expect(drawableMermaid("sequenceDiagram\n    A->>B: hi\n")).toBe("sequenceDiagram\n    A->>B: hi\n");
  });
});
