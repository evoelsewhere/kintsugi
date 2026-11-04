// A new wiki page (AUT-11, DIS-30, ADR-0096 decisions 3 and 4, ADR-0098): its address from a title, an id nobody else has,
// and the text of a template when one is chosen. The result is a draft of the person who asked; nothing is sent to the
// writer until the draft is published.

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { buildBrainDocument, isWikiEditablePath, newPagePath, pageFromTemplate, pageId, pageIdScope, pageTemplatesDir } from "@kintsugi/domain";
import type { Actor } from "#common/auth/decorators.js";
import { BrainService } from "#modules/delivery/brain/index.js";
import { DocumentsService } from "#modules/delivery/documents/index.js";
import type { WikiDraftView } from "../domain/wiki.js";
import { WikiDrafts, WikiIdCounters } from "../domain/wiki.ports.js";
import { WikiAccessService } from "./wiki-access.service.js";
import { WikiDraftService } from "./wiki-draft.service.js";

/** Control characters: a title is one line. */
const CONTROL = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]");
/** The longest title of a new page. */
export const NEW_PAGE_TITLE_MAX = 200;
/** How many `-2`, `-3` names are tried before the title is refused as taken. */
const NAME_ATTEMPTS = 50;
/** The folder of a space's templates (`spaceTemplatesDir` in the layout names the same folder). */
const TEMPLATES_FOLDER = "_templates";

/** A template a new page can start from. */
export interface WikiTemplateOption {
  path: string;
  title: string;
  summary: string;
}

@Injectable()
export class WikiPageService {
  constructor(
    private readonly access: WikiAccessService,
    private readonly draftService: WikiDraftService,
    private readonly drafts: WikiDrafts,
    private readonly counters: WikiIdCounters,
    private readonly documents: DocumentsService,
    private readonly brain: BrainService,
  ) {}

  /**
   * Makes the caller's draft of a new page in `folder`: `<folder>/<slug of the title>.md` (with `-2`, `-3` while a page or
   * a draft of the caller has the name), the id `PAGE-<space key, else DOC>-<number>`, and the text of the template or a
   * title and a front matter. The refusals are those of saving a draft.
   */
  async create(projectId: string, actor: Actor, input: { folder: string; title: string; templatePath?: string | undefined }): Promise<WikiDraftView> {
    const folder = input.folder.trim().replace(/\/+$/, "");
    const title = input.title.trim();
    if (folder === "") throw new BadRequestException("A page lives in a folder: name the folder");
    if (title === "" || title.length > NEW_PAGE_TITLE_MAX || CONTROL.test(title)) throw new BadRequestException(`The title is one line of 1 to ${NEW_PAGE_TITLE_MAX} characters`);

    const taken = new Set<string>();
    let path: string | undefined;
    for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
      path = newPagePath(folder, title, (candidate) => taken.has(candidate));
      if (path === undefined) throw new BadRequestException("The title and the folder cannot name a page: the file name is made of its letters and digits");
      if (!(await this.#exists(projectId, actor, path))) break;
      taken.add(path);
      path = undefined;
    }
    if (path === undefined) throw new BadRequestException(`Too many pages are called like "${title}" in ${folder}`);
    if (!isWikiEditablePath(path)) throw new BadRequestException(`${path} is not a page that can be edited`);
    await this.access.assertCanWrite(projectId, actor, path, "draft");

    const template = input.templatePath === undefined ? undefined : await this.#template(projectId, folder, input.templatePath);
    const scope = pageIdScope(await this.#spaceKey(projectId, folder));
    const id = await this.#allocate(projectId, scope);
    const text = template === undefined ? `---\nid: ${id}\ntitle: ${JSON.stringify(title)}\n---\n\n# ${title}\n` : pageFromTemplate(template, { id, title });
    await this.drafts.create({ projectId, userId: actor.id, path, pageId: id, text, baseCommit: null, baseHash: null });
    return this.draftService.get(projectId, actor, path);
  }

  /**
   * The templates a page of `folder` may start from: those of the folders up to the space (`<folder>/_templates/`) and
   * the system ones (`01-standards/page-templates/`), as the Brain knows them (a page whose front matter says
   * `type: template`).
   */
  async templates(projectId: string, folder: string): Promise<WikiTemplateOption[]> {
    const found = new Map<string, WikiTemplateOption>();
    for (const directory of this.#templateDirectories(folder.trim().replace(/\/+$/, ""))) {
      let children;
      try {
        children = (await this.brain.tree(projectId, { node: `${directory}/`, depth: 1, offset: 0, limit: 200 })).children;
      } catch (error) {
        if (error instanceof NotFoundException) continue;
        throw error;
      }
      for (const child of children) if (child.kind === "document" && child.template) found.set(child.path, { path: child.path, title: child.title, summary: child.summary });
    }
    return [...found.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  /** The folders a page of `folder` finds templates in: its own and every folder above it, then the system ones. */
  #templateDirectories(folder: string): string[] {
    const directories: string[] = [];
    const parts = folder.split("/").filter((part) => part !== "");
    for (let length = parts.length; length > 0; length -= 1) directories.push(`${parts.slice(0, length).join("/")}/${TEMPLATES_FOLDER}`);
    directories.push(pageTemplatesDir());
    return directories;
  }

  /** The text of a template the caller chose: only a page of a templates folder that applies to `folder`, and a template. */
  async #template(projectId: string, folder: string, templatePath: string): Promise<string> {
    if (!this.#templateDirectories(folder).some((directory) => templatePath.startsWith(`${directory}/`)) || !templatePath.toLowerCase().endsWith(".md") || templatePath.slice(templatePath.lastIndexOf("/") + 1).startsWith(".")) {
      throw new BadRequestException(`${templatePath} is not a template that applies to ${folder}`);
    }
    const file = await this.documents.file(projectId, undefined, templatePath);
    if (buildBrainDocument(templatePath, file.content).nodes[0]?.template !== true) throw new BadRequestException(`${templatePath} is not a template: its front matter does not say type: template`);
    return file.content;
  }

  /** The key of the space the folder is in: the space of the nearest folder the Brain knows, null outside any space. */
  async #spaceKey(projectId: string, folder: string): Promise<string | null> {
    const parts = folder.split("/").filter((part) => part !== "");
    for (let length = parts.length; length > 0; length -= 1) {
      try {
        const view = await this.brain.tree(projectId, { node: `${parts.slice(0, length).join("/")}/`, depth: 1, offset: 0, limit: 1 });
        return view.node.space;
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return null;
  }

  /**
   * The next id of the scope: one atomic statement on the counter, which first catches up with the highest id of the scope
   * the Brain knows, so a project that already has pages numbers after them. The writer still refuses an id another file
   * holds, which the Brain may not show yet.
   */
  async #allocate(projectId: string, scope: string): Promise<string> {
    await this.counters.startAfter(projectId, scope, await this.counters.highestInBrain(projectId, scope));
    return pageId(scope, await this.counters.next(projectId, scope));
  }

  /** Whether a page is at `path` at the head of the default branch, or the caller has a draft there. */
  async #exists(projectId: string, actor: Actor, path: string): Promise<boolean> {
    if ((await this.drafts.find(projectId, actor.id, path)) !== undefined) return true;
    return this.documents.file(projectId, undefined, path).then(
      () => true,
      (error: unknown) => !(error instanceof NotFoundException),
    );
  }
}
