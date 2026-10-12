// Scripted outputs for the mock agent backend (KINTSUGI_RUNTIME_MODE=mock and tests): the mock
// backend calls no LLM and writes nothing, so after a mock agent job the runner fills in what a
// real job would have written — the files the step expects and the structured result its
// schema asks for — so that the next steps of a stage get valid inputs. Deterministic: the same
// step over the same source always gets the same files. Never used with a real runtime.

import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listFiles } from "./files.js";

/** A generic topology extraction script: one domain per top-level folder, one module per source file. */
const EXTRACT_TOPOLOGY = (app: string): string => `# Mock topology extraction (written by the mock agent backend, not by a model).
import json, os, sys

EXT = {'.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cs': 'csharp', '.java': 'java', '.kt': 'kotlin',
       '.py': 'python', '.js': 'javascript', '.ts': 'typescript', '.go': 'go', '.rb': 'ruby', '.php': 'php',
       '.cbl': 'cobol', '.cob': 'cobol', '.vb': 'vb', '.rs': 'rust', '.scala': 'scala', '.sql': 'sql'}

def main():
    source, out = sys.argv[1], sys.argv[2]
    domains = {}
    for root, dirs, files in os.walk(source):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
        for name in sorted(files):
            language = EXT.get(os.path.splitext(name)[1].lower())
            if language is None:
                continue
            path = os.path.join(root, name)
            rel = os.path.relpath(path, source).replace(os.sep, '/')
            top = rel.split('/')[0] if '/' in rel else 'root'
            with open(path, encoding='utf-8', errors='replace') as handle:
                loc = sum(1 for line in handle if line.strip())
            domains.setdefault(top, []).append({'id': rel, 'name': name, 'kind': 'module', 'language': language, 'loc': loc, 'file': rel})
    children = [{'id': 'dom:' + top, 'name': top, 'kind': 'domain', 'children': modules} for top, modules in sorted(domains.items())]
    topology = {'system': ${JSON.stringify(app)}, 'root': {'id': 'sys', 'name': ${JSON.stringify(app)}, 'kind': 'system', 'children': children},
                'edges': [], 'entryPoints': [], 'deadEnds': [], 'observations': [], 'flows': []}
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'topology.json'), 'w', encoding='utf-8') as handle:
        json.dump(topology, handle, indent=2)
    print('mock topology: %d domain(s), %d module(s)' % (len(children), sum(len(m) for m in domains.values())))

main()
`;

/** 63 lowercase words: passes merge_topology's 55–90 word and names-in-packet checks. */
const DESCRIPTION = Array.from({ length: 4 }, () => "this node was described by the mock agent backend without reading any packet at all").join(" and ") + ".\n";

/** The sections of an AS-IS unit specification (understand stage), each with a stub line. */
const SPEC_SECTIONS = ["Purpose", "Entry points", "Main flows", "Dependencies", "Data objects", "Business rules applied", "Security findings and risks", "Configuration", "Error handling", "Source references", "Open questions"];
const UNIT_SPEC = /^knowledge\/as-is\/[^/]+\/[^/]+\/[^/]+\.md$/;

function mockFile(path: string, agent: string, app: string): string {
  const name = path.split("/").at(-1) ?? path;
  if (name === "extract_topology.py") return EXTRACT_TOPOLOGY(app);
  if (name === "flows.json") return `${JSON.stringify({ flows: [], observations: [`mock observation of ${app}`] }, null, 2)}\n`;
  if (path.includes("/node-descriptions/")) return DESCRIPTION;
  if (UNIT_SPEC.test(path)) {
    const sections = SPEC_SECTIONS.map((section) => `## ${section}\n\nMock output of ${agent} for ${app} (the mock agent backend calls no LLM).\n`);
    return `# ${name.slice(0, -3)}\n\n${sections.join("\n")}`;
  }
  if (name.endsWith(".mmd")) return `graph TD\n  mock[${agent}] --> output[${name}]\n`;
  if (name.endsWith(".patch")) return `# mock remediation patch of ${app}: no hunks (written by the mock agent backend)\n`;
  if (name.endsWith(".json")) return "{}\n";
  return `# ${name}\n\nMock output of ${agent} for ${app} (the mock agent backend calls no LLM).\n`;
}

interface Schema {
  type?: unknown;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
}

/** A value matching a JSON schema: required properties only, one array item, the first enum value. */
export function sampleOf(schema: Schema | undefined, name: string, citation: string): unknown {
  if (schema === undefined) return null;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  switch (schema.type) {
    case "object": {
      const properties = schema.properties ?? {};
      const keys = Array.isArray(schema.required) ? schema.required : Object.keys(properties);
      return Object.fromEntries(keys.map((key) => [key, sampleOf(properties[key], key, citation)]));
    }
    case "array":
      return [sampleOf(schema.items, name, citation)];
    case "boolean":
      return true;
    case "integer":
    case "number":
      return 1;
    case "string":
      if (name === "source" || name === "correctedSource") return citation;
      if (name === "cwe") return "CWE-20";
      return `mock ${name}`;
    default:
      return null;
  }
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/** The first source file of the checkout (sorted), cited as `path:1-1`. */
async function citation(src: string | undefined): Promise<string> {
  if (src === undefined) return "README.md:1-1";
  const files = (await listFiles(src).catch(() => [])).filter((file) => !file.path.startsWith(".git/") && file.path !== ".git");
  const code = files.find((file) => !/\.(md|txt|json|ya?ml)$/i.test(file.path)) ?? files[0];
  return `${code?.path ?? "README.md"}:1-1`;
}

export interface MockOutputRequest {
  out: string;
  src?: string;
  agent: string;
  app: string;
  /** Files the step expects (output-relative paths). */
  expects: readonly string[];
  /** The structured result's schema; written as result.json. */
  schema?: Record<string, unknown>;
  resultFile: string;
}

/** Writes what the mock job left out; files a test runtime already wrote are kept. */
export async function writeMockOutputs(request: MockOutputRequest): Promise<void> {
  for (const path of request.expects) {
    const target = join(request.out, ...path.split("/"));
    if (await exists(target)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, mockFile(path, request.agent, request.app), "utf8");
  }
  if (request.schema !== undefined) {
    const target = join(request.out, request.resultFile);
    if (!(await exists(target))) await writeFile(target, JSON.stringify(sampleOf(request.schema as Schema, "result", await citation(request.src)), null, 2), "utf8");
  }
}
