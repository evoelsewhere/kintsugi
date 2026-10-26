// A person's answer edits the original specification, in a reviewed PR. Git remains the register.
import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { answerSpecGap } from "@kintsugi/agents/reader";
import { unitAsIsPath } from "@kintsugi/domain";
import type { Actor } from "#common/auth/decorators.js";
import { DocumentWritesService, type DocumentWriteRecord } from "#modules/admin/document-writes/index.js";
import type { GapAnswer } from "../domain/gap-answer.js";
import { DocumentsService } from "./documents.service.js";

@Injectable()
export class GapAnswersService {
  constructor(private readonly documents: DocumentsService, private readonly writes: DocumentWritesService) {}

  async propose(projectId: string, applicationId: string, answer: GapAnswer, actor: Actor): Promise<DocumentWriteRecord> {
    const context = await this.documents.context(projectId);
    if (!context.project.applications.some((app) => app.id === applicationId)) throw new NotFoundException(`Application ${applicationId} not found in project ${projectId}`);
    const [module, unit] = answer.item.split("/") as [string, string];
    const path = unitAsIsPath(applicationId, module, unit);
    const baseline = await this.documents.resolve(context, answer.commit);
    const current = await this.documents.resolve(context, undefined);
    const [old, now] = await Promise.all([this.documents.readText(context, baseline.commit, path), this.documents.readText(context, current.commit, path)]);
    if (now === undefined) throw new NotFoundException(`Merge the specification ${path} before answering its gaps`);
    if (old === undefined || old !== now) throw new ConflictException("The specification changed since these questions were read. Reload the default branch and answer again.");
    let content: string;
    try {
      content = answerSpecGap(now, answer.gap, answer.answer, answer.evidence, answer.status);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Invalid gap answer");
    }
    return this.writes.proposeCorrection(projectId, `${answer.status === "resolved" ? "Resolve" : "Reopen"} ${answer.gap} in ${applicationId}/${answer.item}`, [{ path, content, expectedHash: createHash("sha256").update(now).digest("hex") }], actor);
  }
}
