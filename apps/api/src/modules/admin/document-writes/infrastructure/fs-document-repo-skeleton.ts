// Infrastructure: the document repo starter structure, read from templates/document-repo (the same
// folder the end-to-end seed uses). The template's `billing-web` folder is the per-application
// skeleton: it is made once for every application of the project, with its id in place of the
// sample's. Format samples (`.example`) stay in the template, and kintsugi.yaml is rendered by the
// portal, not copied.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Injectable } from "@nestjs/common";
import type { DocumentWriteFile } from "../domain/document-write.js";
import { DocumentRepoSkeleton } from "../domain/document-write.ports.js";

const TEMPLATE = "templates/document-repo";
/** The sample application folder of the template. */
const SAMPLE_APPLICATION = "applications/billing-web/";
const SAMPLE_ID = "billing-web";
const MANIFEST = "kintsugi.yaml";

/** KINTSUGI_TEMPLATES_DIR, else the `templates` folder above the running code (the repository root, or /app in the image). */
function templatesRoot(): string {
  const configured = process.env["KINTSUGI_TEMPLATES_DIR"];
  if (configured !== undefined && configured !== "") return configured;
  let dir = import.meta.dirname;
  for (;;) {
    if (existsSync(join(dir, TEMPLATE, MANIFEST))) return join(dir, "templates");
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`The document repo template (${TEMPLATE}) was not found; set KINTSUGI_TEMPLATES_DIR`);
    dir = parent;
  }
}

async function walk(root: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await walk(root, path)));
    else if (entry.isFile()) found.push(path);
  }
  return found.sort();
}

/** Samples and the manifest are not part of the structure. */
const isStructure = (path: string): boolean => path !== MANIFEST && !path.split("/").some((segment) => segment.includes(".example") || segment === ".git");

@Injectable()
export class FsDocumentRepoSkeleton extends DocumentRepoSkeleton {
  async files(applicationIds: readonly string[]): Promise<DocumentWriteFile[]> {
    const root = join(templatesRoot(), "document-repo");
    const files: DocumentWriteFile[] = [];
    for (const path of (await walk(root)).filter(isStructure)) {
      const content = await readFile(join(root, path), "utf8");
      if (!path.startsWith(SAMPLE_APPLICATION)) {
        files.push({ path, content, createOnly: true });
        continue;
      }
      const rest = path.slice(SAMPLE_APPLICATION.length);
      for (const id of applicationIds) files.push({ path: `applications/${id}/${rest}`, content: content.replaceAll(SAMPLE_ID, id), createOnly: true });
    }
    return files;
  }
}
