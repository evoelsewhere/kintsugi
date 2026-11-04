// Files and images added to a page while it is edited (ADR-0098 decisions 2 and 9): kept beside the caller's draft in
// Postgres, never served to anyone else, and published with the page into its `_attachments/` folder as base64 files.

import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import { pageAttachmentsDir, pageFolder } from "@kintsugi/domain";
import type { Actor } from "#common/auth/decorators.js";
import { decodeBase64 } from "#common/util/base64.js";
import { DocumentsService } from "#modules/delivery/documents/index.js";
import { ATTACHMENTS_MAX_BYTES, ATTACHMENT_MAX_BYTES, attachmentMarkdown, attachmentTypeOf, safeAttachmentName, sniffAttachmentType, uniqueAttachmentName } from "../domain/wiki.attachments.js";
import type { WikiAttachmentView, WikiDraft } from "../domain/wiki.js";
import { WikiAttachments, WikiDrafts } from "../domain/wiki.ports.js";
import { WikiAccessService } from "./wiki-access.service.js";

export interface AttachInput {
  /** The page whose draft the file is added to. */
  path: string;
  name: string;
  contentType: string;
  contentBase64: string;
}

@Injectable()
export class WikiAttachmentService {
  constructor(
    private readonly drafts: WikiDrafts,
    private readonly attachments: WikiAttachments,
    private readonly documents: DocumentsService,
    private readonly access: WikiAccessService,
  ) {}

  /**
   * Keeps a file for the caller's draft of the page. The name is made safe and unique among the draft's files and the
   * ones the page's `_attachments/` folder already has; the bytes must be the type the name and the caller say.
   */
  async add(projectId: string, actor: Actor, input: AttachInput): Promise<WikiAttachmentView> {
    await this.access.assertCanWrite(projectId, actor, input.path, "draft");
    const draft = await this.#draftOf(projectId, actor, input.path);
    const folder = this.#folderOf(input.path);

    const safe = safeAttachmentName(input.name);
    if (safe === undefined) throw new BadRequestException(`${input.name} cannot be attached: only png, jpg, jpeg, gif, webp and pdf files can`);
    const wanted = attachmentTypeOf(safe)!;
    if (input.contentType.toLowerCase() !== wanted) throw new BadRequestException(`${safe} is ${wanted} by its name and ${input.contentType} by what was sent`);
    const bytes = decodeBase64(input.contentBase64);
    if (bytes === undefined) throw new BadRequestException("contentBase64 is not valid base64");
    if (bytes.length === 0) throw new BadRequestException(`${safe} is empty`);
    if (bytes.length > ATTACHMENT_MAX_BYTES) throw new PayloadTooLargeException(`${safe} is larger than ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MiB`);
    const sniffed = sniffAttachmentType(bytes);
    if (sniffed !== wanted) throw new BadRequestException(`The content of ${safe} is ${sniffed ?? "not one of the allowed types"}, not ${wanted}`);

    const held = await this.attachments.list(draft.id);
    if (held.reduce((sum, file) => sum + file.size, 0) + bytes.length > ATTACHMENTS_MAX_BYTES) {
      throw new PayloadTooLargeException(`The attachments of a draft weigh at most ${ATTACHMENTS_MAX_BYTES / (1024 * 1024)} MiB`);
    }
    const taken = new Set([...held.map((file) => file.name), ...(await this.#inRepository(projectId, folder))]);
    const name = uniqueAttachmentName(safe, taken);
    await this.attachments.put(draft.id, { name, contentType: wanted, bytes });
    return { name, contentType: wanted, size: bytes.length, markdown: attachmentMarkdown(name, wanted) };
  }

  /** The files kept for the caller's draft of the page; none when there is no draft. */
  async list(projectId: string, actor: Actor, path: string): Promise<WikiAttachmentView[]> {
    const draft = await this.drafts.find(projectId, actor.id, path);
    if (draft === undefined) return [];
    return (await this.attachments.list(draft.id)).map((file) => ({ ...file, markdown: attachmentMarkdown(file.name, file.contentType) }));
  }

  async remove(projectId: string, actor: Actor, path: string, name: string): Promise<void> {
    this.access.assertHasWritePermission(actor);
    const draft = await this.#draftOf(projectId, actor, path);
    if (!(await this.attachments.remove(draft.id, name))) throw new NotFoundException(`The draft of ${path} has no attachment ${name}`);
  }

  /** One of the caller's own files: its stored content type and bytes. */
  async file(projectId: string, actor: Actor, path: string, name: string): Promise<{ contentType: string; bytes: Buffer }> {
    const draft = await this.drafts.find(projectId, actor.id, path);
    const read = draft === undefined ? undefined : await this.attachments.read(draft.id, name);
    if (read === undefined) throw new NotFoundException(`The draft of ${path} has no attachment ${name}`);
    return read;
  }

  /** The files of a draft as the writer takes them: base64 under the page's `_attachments/` folder, new files only. */
  async asWrites(draft: WikiDraft): Promise<Array<{ path: string; content: string; encoding: "base64"; createOnly: true }>> {
    const folder = this.#folderOf(draft.path);
    return (await this.attachments.readAll(draft.id)).map((file) => ({ path: `${folder}/${file.name}`, content: file.bytes.toString("base64"), encoding: "base64" as const, createOnly: true as const }));
  }

  async #draftOf(projectId: string, actor: Actor, path: string): Promise<WikiDraft> {
    const draft = await this.drafts.find(projectId, actor.id, path);
    if (draft === undefined) throw new NotFoundException(`You have no draft of ${path}: save it first`);
    return draft;
  }

  /** The `_attachments/` folder of the page; 400 for a page that cannot hold files beside it. */
  #folderOf(path: string): string {
    try {
      return pageAttachmentsDir(pageFolder(path));
    } catch {
      throw new BadRequestException(`${path} is not in a folder that can hold attachments`);
    }
  }

  /** The names of the files the folder already has on the default branch. */
  async #inRepository(projectId: string, folder: string): Promise<string[]> {
    const context = await this.documents.context(projectId);
    const { defaultTip } = await this.documents.branchTips(context);
    if (defaultTip === undefined) return [];
    return (await this.documents.listNames(context, defaultTip.commit, folder)).filter((entry) => entry.kind === "file").map((entry) => entry.name);
  }
}
