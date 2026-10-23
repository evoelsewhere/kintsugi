// The topology extraction shared by the plans (commands/modernize-understand.md, ADR-0033): a
// legacy-analyst job writes extract_topology.py and a script step runs it in the standard script
// environment (model-written, no review gate; on failure the job gets the error once to fix it). The raw
// topology (every leaf and edge) is scratch JSON of the run; render_topology.py checks it and publishes the
// summary, topology.md (ADR-0042), and the catalog scripts read the raw one in the same job.
//
// Not wired yet: persona flows, per-node descriptions and chunked mapping of big estates.

import type { AgentStep, ScriptStep } from "../plan.js";
import { DOCUMENT_PATH_TOKENS, applicationInputPath, assessmentDir, assessmentInventoryPath, assessmentTopologyPath, scratchDir, scratchInventoryPath, scratchTopologyPath } from "@kintsugi/domain";
import { CREDENTIALS, UNTRUSTED, WORKSPACE } from "./common.js";

const APP_TOKEN = DOCUMENT_PATH_TOKENS.app;
const DIR = assessmentDir(APP_TOKEN);
const SCRATCH = scratchDir(APP_TOKEN);

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
them), {in}/${scratchInventoryPath(APP_TOKEN)} the measured inventory (every file; {in}/${assessmentInventoryPath(APP_TOKEN)} summarises it), and {in}/${applicationInputPath(APP_TOKEN, "graph")}/ a dependency export a person attached
(a compiler index, jdeps, a call graph in JSON, CSV, DOT or GraphML): if one exists, map its nodes and edges instead of
parsing the code, spot-check about ten edges against the source, and still add what graphs omit (entry points from
deployment configuration, data stores).

The script does the reading of the source tree, not you: never read the code file by file to build the topology
yourself. Take the layout and the file list from the inputs above, then read only what teaches you how modules refer
to each other in these repositories: their entry points and build or deployment configuration, and one or two
representative files per domain (about 15 files in all; stop reading as soon as you can name the reference patterns).
Then write ${script} with write, early, and refine it with edit rather than rewriting it: a Python 3 script using the
standard library only. You cannot run it (no shell): a script step runs it after you finish and gives you its error once
to fix, so do not re-read your own output to check it. It is run as
\`python extract_topology.py <source dir> <output dir>\`: it reads only the source directory, uses no network, writes <output dir>/topology.json and prints a summary (at most about 200 lines) headed by
"Legacy sources {sources}". It runs in a sandboxed script environment with a time limit, so keep it simple
and bounded: a few hundred lines of general patterns (regular expressions over the files it walks, one function per
reference pattern), never a list of this repository's files or classes written out by hand.

The <source dir> holds one folder per legacy repository of the application, so every file path the script sees and writes
starts with the folder of its repository (a leaf's file is, for example, <repository id>/src/Billing.java). A domain may
span several repositories, and an edge may cross them: resolve a dependency declared in the build file of one repository
(a library, a shared module), an import or a service call that targets another repository of the application to the leaf
in that repository, not to a stub.

What it extracts: the call graph (direct calls, imports, and dispatcher calls whose targets are variables: config
tables, route maps, dependency injection; resolve variables against configuration before calling an edge
unresolvable), data dependencies (which modules read or write which stores, joined through the relevant
configuration), entry points (from deployment configuration, routes, main(), schedulers) and dead-end candidates
(modules with no inbound edge, never one that could be the target of an unresolved dynamic call). For fixed-column
source (COBOL columns 8–72, RPG), slice the code area and strip comment lines before matching.

topology.json must follow this schema exactly, with every top-level key present (observations and flows may stay
empty lists; a later job fills them):
${SCHEMA}
Leaf kinds, by what the leaf is to the outside world: screen (an interactive page, form, panel or transaction with a map),
api (a synchronous interface other programs call: an endpoint group, a service operation), job (unattended work started
by a schedule or an operator: a scheduled task, a JCL job with its steps), report (produces a document or an extract for
people), event (reacts to a message: a queue or topic listener, a webhook), interface (an exchange of data with an
external system: a file feed, an outbound client), module (logic with no entry point of its own, used by others; the
default) and datastore. Use the most specific kind that fits; a file that serves two roles takes its main one. Edge kinds:
call, dispatch, read, write. A screen that calls an endpoint gets a call edge to the api leaf that serves it, even when
that leaf is in another repository (match by route or operation name); a job gets a dispatch edge to the programs its
steps run; a call whose target you cannot find is an observation, not a guessed edge. Every edge endpoint, entry point
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

Fix the script and write the corrected version to ${script} with write (standard library
only, no network, reads only the source directory). Keep the topology.json schema and every top-level key.

${CREDENTIALS}
${UNTRUSTED}`;

/**
 * The topology extraction as three steps: a legacy-analyst job writes the extraction script at `script`
 * (a document-repo path), a script step runs it to the run's scratch topology (`scratchTopologyPath`) and,
 * when it fails, the job gets the error once to fix it; then render_topology.py checks the result and writes
 * the summary at `assessmentTopologyPath`. `domains` tells the job where the domains found so far are. Used
 * by `assess` (ADR-0033).
 */
export function topologySteps(script: string, domains: string): [AgentStep, ScriptStep, ScriptStep] {
  return [
    { id: "topology", kind: "agent", agent: "legacy-analyst", task: topologyTask(script, domains), expects: [script] },
    {
      id: "extract",
      kind: "script",
      script,
      fromInputs: true,
      args: ["{src}", "{out}/" + SCRATCH],
      intermediate: [scratchTopologyPath(APP_TOKEN)],
      expects: [scratchTopologyPath(APP_TOKEN)],
      repair: { id: "topology-fix", kind: "agent", agent: "legacy-analyst", task: repairTask(script), expects: [script] },
    },
    {
      id: "topology-render",
      kind: "script",
      script: "render_topology.py",
      args: ["{app}", "--topology", `{in}/${scratchTopologyPath(APP_TOKEN)}`, "--out", "{out}/" + DIR],
      expects: [assessmentTopologyPath(APP_TOKEN)],
    },
  ];
}

interface TreeNode {
  kind?: unknown;
  children?: unknown;
}

/** Leaf nodes of the raw topology.json of a run (0 when it is missing or malformed). */
export function leafCount(topology: unknown): number {
  const walk = (node: unknown): number => {
    if (typeof node !== "object" || node === null) return 0;
    const { kind, children } = node as TreeNode;
    const own = typeof kind === "string" && kind !== "system" && kind !== "domain" ? 1 : 0;
    return own + (Array.isArray(children) ? children.reduce((sum: number, child) => sum + walk(child), 0) : 0);
  };
  return walk((topology as { root?: unknown } | undefined)?.root);
}
