// `directPublishPaths` of kintsugi.yaml at the head of the default branch (ADR-0098 decision 4): the paths a page may be
// published to without a pull request. The mirror is read; nothing about the file is trusted beyond a list of globs.

import { Injectable, Logger } from "@nestjs/common";
import { parseKintsugiYaml } from "@kintsugi/manifest";
import { DocumentsService } from "#modules/delivery/documents/index.js";
import { WikiDirectPublish } from "../domain/wiki.ports.js";

/** A manifest is a small file. */
const MANIFEST_MAX_BYTES = 512 * 1024;

@Injectable()
export class ManifestDirectPublish extends WikiDirectPublish {
  readonly #logger = new Logger(ManifestDirectPublish.name);

  constructor(private readonly documents: DocumentsService) {
    super();
  }

  async globs(projectId: string): Promise<readonly string[]> {
    try {
      const context = await this.documents.context(projectId);
      const { defaultTip } = await this.documents.branchTips(context);
      if (defaultTip === undefined) return [];
      const text = await this.documents.readText(context, defaultTip.commit, "kintsugi.yaml", MANIFEST_MAX_BYTES);
      const parsed = text === undefined ? undefined : parseKintsugiYaml(text);
      if (parsed === undefined || !parsed.ok) return [];
      const globs = (parsed.manifest as { directPublishPaths?: unknown }).directPublishPaths;
      return Array.isArray(globs) ? globs.filter((glob): glob is string => typeof glob === "string") : [];
    } catch (error) {
      // No mirror yet, or the file cannot be read: nothing can be published directly, which is the safe answer.
      this.#logger.warn(`Could not read directPublishPaths of ${projectId}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
}
