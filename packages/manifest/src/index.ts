// kintsugi.yaml as text (ADR-0028, docs/reference/document-repo-manifest.md): parse and validate
// it, or render it from a manifest. The model and its rules live in @kintsugi/domain
// (which stays dependency-free); this package only adds YAML.

import { type KintsugiManifest, type ManifestResult, validateManifest } from "@kintsugi/domain";
import { Document, isMap, isSeq, parseDocument } from "yaml";

export type { KintsugiManifest, ManifestResult } from "@kintsugi/domain";

/** File name of the manifest at the root of the document repo. */
export const MANIFEST_FILE = "kintsugi.yaml";

/** Parses and validates kintsugi.yaml; YAML syntax errors and schema problems are all reported. */
export function parseKintsugiYaml(text: string): ManifestResult {
  const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    return { ok: false, problems: document.errors.map((error) => ({ path: "", message: error.message })) };
  }
  return validateManifest(document.toJS());
}

/** Renders a manifest as kintsugi.yaml, with an optional header comment. */
export function renderKintsugiYaml(manifest: KintsugiManifest, options: { header?: string } = {}): string {
  const document = new Document(manifest);
  if (options.header !== undefined) document.commentBefore = options.header.split("\n").map((line) => (line === "" ? "" : ` ${line}`)).join("\n");

  // Short lists and repository entries read best on one line, as in the reference.
  for (const path of [["unitKinds"], ["policy", "harnesses"]]) {
    const node = document.getIn(path, true);
    if (isSeq(node)) node.flow = true;
  }
  const applications = document.get("applications", true);
  if (isSeq(applications)) {
    for (const application of applications.items) {
      const repos = isMap(application) ? application.get("repos", true) : undefined;
      if (!isSeq(repos)) continue;
      for (const repo of repos.items) if (isMap(repo)) repo.flow = true;
    }
  }
  return document.toString({ lineWidth: 0, flowCollectionPadding: false });
}
