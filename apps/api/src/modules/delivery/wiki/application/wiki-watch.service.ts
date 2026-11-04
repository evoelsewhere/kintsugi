// Watching pages, folders and spaces (ADR-0099 decision 3): a person's own list of what they want to hear about. Only
// the person's own watches are ever read or changed; no permission but Project Access (the route's guard) is needed.
// What is watched is made canonical here: a page with an id by its id (a move keeps the watch), a folder or a space only
// when the Brain knows it.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { isPageId, isWikiEditablePath } from "@kintsugi/domain";
import type { Actor } from "#common/auth/decorators.js";
import { BrainService } from "#modules/delivery/brain/index.js";
import type { WikiPageWatch, WikiWatch, WikiWatchScope, WikiWatchView } from "../domain/wiki.js";
import { WIKI_WATCH_LIMIT, WikiWatches } from "../domain/wiki.ports.js";

const PATH_PREFIX = "path:";

export interface WatchInput {
  scopeKind: WikiWatchScope;
  target: string;
}

@Injectable()
export class WikiWatchService {
  constructor(
    private readonly watches: WikiWatches,
    private readonly brain: BrainService,
  ) {}

  /** The caller's watches in the project, newest first, each with the path and title the Brain gives what it watches. */
  async list(projectId: string, actor: Actor): Promise<WikiWatchView[]> {
    const mine = await this.watches.listOf(projectId, actor.id);
    return Promise.all(mine.map((watch) => this.#named(projectId, watch)));
  }

  /**
   * Watches a page (by its path or its id), a folder (its path) or a space (its key). A second time is not an error and
   * changes nothing. 400 for a folder or a space the Brain does not know; 409 at 500 watches or while the Brain is not built.
   */
  async watch(projectId: string, actor: Actor, input: WatchInput): Promise<WikiWatchView> {
    const target = await this.#canonical(projectId, input);
    const added = await this.watches.add(projectId, actor.id, input.scopeKind, target);
    if (added === undefined) throw new ConflictException(`You are watching ${WIKI_WATCH_LIMIT} pages, folders and spaces in this project, the most there can be; stop watching one first`);
    const stored = (await this.watches.among(projectId, actor.id, [{ scopeKind: input.scopeKind, target }]))[0]!;
    return this.#named(projectId, stored);
  }

  /** Stops watching; 404 when the caller did not watch it. The page may be given by its path or its id, also when it is gone. */
  async unwatch(projectId: string, actor: Actor, input: WatchInput): Promise<void> {
    const candidates = [await this.#canonical(projectId, input).catch(() => undefined), input.target].filter((target): target is string => target !== undefined);
    for (const target of new Set(candidates)) if (await this.watches.remove(projectId, actor.id, input.scopeKind, target)) return;
    throw new NotFoundException(`You are not watching ${input.target}`);
  }

  /** Whether the caller watches the page, itself or through a folder above it or its space; the nearest one is named. */
  async ofPage(projectId: string, actor: Actor, path: string): Promise<WikiPageWatch> {
    if (!isWikiEditablePath(path)) throw new BadRequestException(`${path} is not a page`);
    const known = await this.#pageNode(projectId, path);
    const targets: Array<{ scopeKind: WikiWatchScope; target: string }> = [{ scopeKind: "page", target: `${PATH_PREFIX}${path}` }];
    if (known?.id !== undefined) targets.unshift({ scopeKind: "page", target: known.id });
    const parts = path.split("/").slice(0, -1);
    for (let length = parts.length; length > 0; length -= 1) targets.push({ scopeKind: "folder", target: parts.slice(0, length).join("/") });
    if (known?.space !== undefined && known.space !== null) targets.push({ scopeKind: "space", target: known.space });
    const found = await this.watches.among(projectId, actor.id, targets);
    // The order of `targets` is the order of nearness: the page, then its folders from the nearest, then the space.
    const hit = targets.find((entry) => found.some((watch) => watch.scopeKind === entry.scopeKind && watch.target === entry.target));
    return { path, watched: hit !== undefined, direct: hit?.scopeKind === "page", via: hit === undefined || hit.scopeKind === "page" ? null : hit };
  }

  /** The target as it is stored: see the class comment. */
  async #canonical(projectId: string, input: WatchInput): Promise<string> {
    const raw = input.target.trim();
    if (input.scopeKind === "page") return this.#pageTarget(projectId, raw);
    if (input.scopeKind === "folder") {
      const folder = raw.replace(/^\/+|\/+$/g, "");
      if (folder === "" || folder.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) throw new BadRequestException(`${raw} is not a folder of the document repo`);
      await this.#requireKnown(() => this.brain.tree(projectId, { node: `${folder}/`, depth: 1, offset: 0, limit: 1 }), `${folder} is not a folder the wiki knows`);
      return folder;
    }
    const key = raw.toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) throw new BadRequestException(`${raw} is not a space key`);
    const matches = await this.brain.lookup(projectId, `space:${key}`);
    if (matches.matches.length === 0) throw new BadRequestException(`${key} is not a space the wiki knows`);
    return key;
  }

  /** A page's target: its id when it has one (given, or the Brain's), else `path:<path>`. */
  async #pageTarget(projectId: string, raw: string): Promise<string> {
    if (isPageId(raw)) {
      const found = await this.#pageById(projectId, raw);
      if (found === undefined) throw new BadRequestException(`${raw} is not the id of a page the wiki knows`);
      return raw;
    }
    const path = raw.startsWith(PATH_PREFIX) ? raw.slice(PATH_PREFIX.length) : raw;
    if (!isWikiEditablePath(path) || !path.toLowerCase().endsWith(".md")) throw new BadRequestException(`${raw} is not a page`);
    const node = await this.#pageNode(projectId, path);
    return node?.id ?? `${PATH_PREFIX}${path}`;
  }

  /** The Brain's page at the path: its id (the first page id its front matter gives) and its space; undefined when the Brain does not know it. */
  async #pageNode(projectId: string, path: string): Promise<{ id: string | undefined; space: string | null; title: string } | undefined> {
    try {
      const node = (await this.brain.lookup(projectId, path)).matches.find((match) => match.kind === "document" && match.path === path);
      return node === undefined ? undefined : { id: node.ids.find((id) => isPageId(id)), space: node.space, title: node.title };
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) return undefined;
      throw error;
    }
  }

  async #pageById(projectId: string, id: string): Promise<{ path: string; title: string } | undefined> {
    try {
      const node = (await this.brain.lookup(projectId, id)).matches.find((match) => match.kind === "document" && match.ids.includes(id));
      return node === undefined ? undefined : { path: node.path, title: node.title };
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) return undefined;
      throw error;
    }
  }

  /** Runs a Brain read for a folder: a node the Brain does not have is a 400, a Brain that is not built a 409 (the Brain's own). */
  async #requireKnown<T>(read: () => Promise<T>, unknown: string): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof NotFoundException) throw new BadRequestException(unknown);
      throw error;
    }
  }

  /** The names of what a watch watches, from the Brain; null when the Brain does not know it (any more). */
  async #named(projectId: string, watch: WikiWatch): Promise<WikiWatchView> {
    if (watch.scopeKind === "folder") return { ...watch, path: watch.target, title: null };
    if (watch.scopeKind === "space") return { ...watch, path: null, title: null };
    if (watch.target.startsWith(PATH_PREFIX)) {
      const path = watch.target.slice(PATH_PREFIX.length);
      return { ...watch, path, title: (await this.#pageNode(projectId, path))?.title ?? null };
    }
    const found = await this.#pageById(projectId, watch.target);
    return { ...watch, path: found?.path ?? null, title: found?.title ?? null };
  }
}
