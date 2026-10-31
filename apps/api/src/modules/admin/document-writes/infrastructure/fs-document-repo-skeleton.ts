// Infrastructure: the document repo starter structure, read from templates/document-repo, and the
// per-application skeleton, read from templates/document-repo-application. The starter holds no
// application: the skeleton is made once for every application of the project under
// 10-applications/<app>/, with the application's id in place of `{{app}}`. Format samples
// (`.example`) stay in the templates, and kintsugi.yaml is rendered by the portal, not copied.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Injectable } from "@nestjs/common";
import { applicationDir } from "@kintsugi/domain";
import type { DocumentWriteFile } from "../domain/document-write.js";
import { DocumentRepoSkeleton } from "../domain/document-write.ports.js";

const TEMPLATE = "templates/document-repo";
/** The folder of the per-application skeleton, beside the starter. */
const APPLICATION_TEMPLATE = "document-repo-application";
/** Where the skeleton names its application. */
const APPLICATION_TOKEN = "{{app}}";
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
    const root = templatesRoot();
    const files: DocumentWriteFile[] = [];
    const starter = join(root, "document-repo");
    for (const path of (await walk(starter)).filter(isStructure)) {
      files.push({ path, content: await readFile(join(starter, path), "utf8"), createOnly: true });
    }
    const application = join(root, APPLICATION_TEMPLATE);
    for (const path of (await walk(application)).filter(isStructure)) {
      const content = await readFile(join(application, path), "utf8");
      for (const id of applicationIds) files.push({ path: `${applicationDir(id)}/${path}`, content: content.replaceAll(APPLICATION_TOKEN, id), createOnly: true });
    }
    return files;
  }
}
