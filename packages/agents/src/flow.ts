// The flow of a command (ADR-0035): what a stage runs, in order, as data in the command's
// frontmatter (`metadata.flow`). The portal draws it; a test in the orchestrator keeps it equal to
// the stage plan that really runs, so the picture cannot drift from the code.
//
//   flow:
//     - script: inventory                  # a script of the plugin (scripts/inventory.py)
//     - parallel:                          # these run at the same time
//         - agent: legacy-analyst
//           as: structure                  # what this run is for (a label)
//         - agent: security-auditor
//     - script: extract_topology
//       generated: true                    # written by an agent during the run, not a plugin file
//       repair: legacy-analyst             # an agent fixes it once when it fails
//     - workflow: extract-rules            # a workflow of the plugin (workflows/extract-rules.js)
//     - each: catalog item                 # once per item
//       do:
//         agent: legacy-analyst
//     - gate: a person reviews the pull request
//
// A command a member's harness carries out has steps no script or agent of the plugin runs: what the harness is told to do.
// They are `step:` entries, optionally with the Kintsugi `tool` it uses and the `skill` it follows (a hint for the picture).
//
//   flow:
//     - step: Read the unit's rules and design
//       tool: document_get
//     - gate: you approve the plan before any code is written
//     - step: Implement the unit
//       skill: build-method

export type FlowNode =
  | { kind: "script"; name: string; label?: string; generated?: boolean; repair?: string }
  | { kind: "agent"; name: string; label?: string }
  | { kind: "workflow"; name: string; label?: string }
  | { kind: "parallel"; steps: FlowNode[] }
  | { kind: "each"; label: string; step: FlowNode }
  | { kind: "gate"; label: string }
  /** A step the member's harness carries out; `tool` is the Kintsugi tool it calls, `skill` the skill it follows. */
  | { kind: "step"; label: string; tool?: string; skill?: string };

const NAME = /^[a-z][a-z0-9_-]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function parseNode(value: unknown, where: string, problems: string[]): FlowNode | undefined {
  if (!isRecord(value)) {
    problems.push(`${where}: a flow step must be a mapping`);
    return undefined;
  }
  const label = typeof value["as"] === "string" ? { label: value["as"] } : {};
  const named = (kind: "script" | "agent" | "workflow"): string | undefined => {
    const name = value[kind];
    if (typeof name !== "string" || !NAME.test(name)) {
      problems.push(`${where}: \`${kind}\` must be a name like inventory or legacy-analyst`);
      return undefined;
    }
    return name;
  };
  if ("step" in value) {
    const text = value["step"];
    if (typeof text !== "string" || text.trim() === "") {
      problems.push(`${where}: \`step\` must say what the harness does`);
      return undefined;
    }
    const tool = value["tool"];
    const skill = value["skill"];
    if ((tool !== undefined && (typeof tool !== "string" || !NAME.test(tool))) || (skill !== undefined && (typeof skill !== "string" || !NAME.test(skill)))) {
      problems.push(`${where}: \`tool\` and \`skill\` must be names like document_get or build-method`);
      return undefined;
    }
    return { kind: "step", label: text.trim(), ...(tool === undefined ? {} : { tool: tool as string }), ...(skill === undefined ? {} : { skill: skill as string }) };
  }
  if ("script" in value) {
    const name = named("script");
    if (name === undefined) return undefined;
    return {
      kind: "script",
      name,
      ...label,
      ...(value["generated"] === true ? { generated: true } : {}),
      ...(typeof value["repair"] === "string" ? { repair: value["repair"] } : {}),
    };
  }
  if ("agent" in value) {
    const name = named("agent");
    return name === undefined ? undefined : { kind: "agent", name, ...label };
  }
  if ("workflow" in value) {
    const name = named("workflow");
    return name === undefined ? undefined : { kind: "workflow", name, ...label };
  }
  if ("parallel" in value) {
    const steps = parseFlow(value["parallel"], `${where} → parallel`, problems);
    return steps === undefined ? undefined : { kind: "parallel", steps };
  }
  if ("each" in value) {
    if (typeof value["each"] !== "string") {
      problems.push(`${where}: \`each\` names what the step runs for, e.g. "catalog item"`);
      return undefined;
    }
    const step = parseNode(value["do"], `${where} → do`, problems);
    return step === undefined ? undefined : { kind: "each", label: value["each"], step };
  }
  if ("gate" in value) {
    if (typeof value["gate"] !== "string" || value["gate"].trim() === "") {
      problems.push(`${where}: \`gate\` must say what a person decides`);
      return undefined;
    }
    return { kind: "gate", label: value["gate"] };
  }
  problems.push(`${where}: a flow step is a script, agent, workflow, parallel, each, gate or step`);
  return undefined;
}

/** Parses a `metadata.flow` list; undefined (with the problems recorded) when it is not valid. */
export function parseFlow(value: unknown, where: string, problems: string[]): FlowNode[] | undefined {
  if (!Array.isArray(value)) {
    problems.push(`${where}: \`flow\` must be a list of steps`);
    return undefined;
  }
  const before = problems.length;
  const nodes = value.map((entry, index) => parseNode(entry, `${where}[${index}]`, problems));
  return problems.length > before ? undefined : (nodes as FlowNode[]);
}

/** Every named component a flow uses, to check it exists in the plugin. */
export function flowComponents(nodes: readonly FlowNode[]): Array<{ kind: "script" | "agent" | "workflow"; name: string; generated?: boolean }> {
  return nodes.flatMap((node): Array<{ kind: "script" | "agent" | "workflow"; name: string; generated?: boolean }> => {
    switch (node.kind) {
      case "script":
        return [{ kind: "script", name: node.name, ...(node.generated === true ? { generated: true } : {}) }, ...(node.repair === undefined ? [] : [{ kind: "agent" as const, name: node.repair }])];
      case "agent":
      case "workflow":
        return [{ kind: node.kind, name: node.name }];
      case "parallel":
        return flowComponents(node.steps);
      case "each":
        return flowComponents([node.step]);
      case "gate":
      case "step":
        return [];
    }
  });
}
