// The topology extraction shared by the plans (commands/modernize-understand.md, ADR-0033): a
// legacy-analyst job writes extract_topology.py and a script step runs it in the standard script
// environment (model-written, no review gate; on failure the job gets the error once to fix it).
// `assess` runs it; `understand` cuts the per-item fragments from the result.
//
// Not wired yet: persona flows, per-node descriptions (node_packets.py, merge_topology.py) and the
// exportable Mermaid diagrams that the former `map` stage wrote, and chunked mapping of big estates.

import type { AgentStep, ScriptStep } from "../plan.js";
import { CREDENTIALS, UNTRUSTED, WORKSPACE } from "./common.js";

const DIR = "assessment/{app}";

const SCHEMA = `{
  "system": "<display name>",
  "root": { "id": "sys", "name": "<system>", "kind": "system",
    "children": [
      { "id": "dom:<domain>", "name": "<Domain>", "kind": "domain",
        "children": [ { "id": "<MODULE>", "name": "<MODULE>", "kind": "module", "language": "<lang>", "loc": 1234, "file": "src/MODULE.ext" } ] },
      { "id": "dom:data", "name": "Data stores", "kind": "domain",
        "children": [ { "id": "ds:<NAME>", "name": "<NAME>", "kind": "datastore" } ] } ] },
  "edges": [ { "source": "<leaf id>", "target": "<leaf id>", "kind": "call" } ],
  "entryPoints": ["<leaf id>"], "deadEnds": ["<leaf id>"], "observations": [], "flows": []
}`;

const topologyTask = (script: string, domains: string): string => `Write the topology extraction script of application {app}.

${WORKSPACE}

If present, ${domains} (group modules under
them), {in}/${DIR}/inventory.json the measured inventory, and {in}/${DIR}/graph/ a dependency export a person attached
(a compiler index, jdeps, a call graph in JSON, CSV, DOT or GraphML): if one exists, map its nodes and edges instead of
parsing the code, spot-check about ten edges against the source, and still add what graphs omit (entry points from
deployment configuration, data stores).

Read the repository, then write ${script} with outputs_write: a Python 3 script using the standard
library only. It is run as \`python extract_topology.py <source dir> <output dir>\`: it reads only the source directory,
uses no network, writes <output dir>/topology.json and prints a summary (at most about 200 lines) headed by
"Legacy repository {repo} at {commit}". It runs in a sandboxed script environment with a time limit, so keep it simple
and bounded.

What it extracts: the call graph (direct calls, imports, and dispatcher calls whose targets are variables: config
tables, route maps, dependency injection; resolve variables against configuration before calling an edge
unresolvable), data dependencies (which modules read or write which stores, joined through the relevant
configuration), entry points (from deployment configuration, routes, main(), schedulers) and dead-end candidates
(modules with no inbound edge, never one that could be the target of an unresolved dynamic call). For fixed-column
source (COBOL columns 8–72, RPG), slice the code area and strip comment lines before matching.

topology.json must follow this schema exactly, with every top-level key present (observations and flows may stay
empty lists; a later job fills them):
${SCHEMA}
Leaf kinds: module, datastore, job, screen; edge kinds: call, dispatch, read, write; every edge endpoint, entry point
and dead end is a leaf id. A leaf's file is its own source file (a directory for a module made of many files); never
give two leaves the same file. Datastore ids and names are logical identifiers (at most host:port): strip userinfo and
credential parameters from any URL or DSN, and never copy raw configuration values into the file.

${CREDENTIALS}
${UNTRUSTED}`;

const repairTask = (script: string): string => `The topology extraction script of application {app} failed.

${WORKSPACE}

The script is {in}/${script}; it is run as \`python extract_topology.py <source dir> <output dir>\` and
must write <output dir>/topology.json. It failed with:

{error}

Fix the script and write the corrected version to ${script} with outputs_write (standard library
only, no network, reads only the source directory). Keep the topology.json schema and every top-level key.

${CREDENTIALS}
${UNTRUSTED}`;

/**
 * The topology extraction as two steps: a legacy-analyst job writes the extraction script at `script`
 * (a document-repo path), a script step runs it into `assessment/{app}/topology.json`, and when it
 * fails the job gets the error once to fix it. `domains` tells the job where the domains found so far
 * are. Used by `assess` (ADR-0033).
 */
export function topologySteps(script: string, domains: string): [AgentStep, ScriptStep] {
  return [
    { id: "topology", kind: "agent", agent: "legacy-analyst", task: topologyTask(script, domains), expects: [script] },
    {
      id: "extract",
      kind: "script",
      script,
      fromInputs: true,
      args: ["{src}", `{out}/${DIR}`],
      expects: [`${DIR}/topology.json`],
      repair: { id: "topology-fix", kind: "agent", agent: "legacy-analyst", task: repairTask(script), expects: [script] },
    },
  ];
}

interface TreeNode {
  kind?: unknown;
  children?: unknown;
}

/** Leaf nodes of topology.json (0 when it is missing or malformed). */
export function leafCount(topology: unknown): number {
  const walk = (node: unknown): number => {
    if (typeof node !== "object" || node === null) return 0;
    const { kind, children } = node as TreeNode;
    const own = typeof kind === "string" && kind !== "system" && kind !== "domain" ? 1 : 0;
    return own + (Array.isArray(children) ? children.reduce((sum: number, child) => sum + walk(child), 0) : 0);
  };
  return walk((topology as { root?: unknown } | undefined)?.root);
}
