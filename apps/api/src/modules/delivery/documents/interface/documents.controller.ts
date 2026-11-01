// Interface layer: read-only document repo content from Kintsugi's mirror (ADR-0025, ADR-0028)
// and the results of a stage built from it. Every route needs Project Access on the project (ADR-0099 decision 4)
// and no permission: the documents are what the project shares; restricted records are never committed and never
// served here. The bounded answer route needs documents.resolve too and proposes its correction through the writer.

import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import type { DocumentWriteRecord } from "#modules/admin/document-writes/index.js";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { GapAnswersService } from "../application/gap-answers.service.js";
import type { GapAnswer } from "../domain/gap-answer.js";
import { type CompareQuery, compareQuerySchema, gapAnswerSchema } from "./document.dto.js";
import type { DocumentCompare } from "../domain/document.js";
import { DocumentsService } from "../application/documents.service.js";
import { StageResultsService } from "../application/stage-results.service.js";
import type { DocumentFile, DocumentHistory, DocumentRefs, DocumentTree, StageHeadline, StageResults } from "../domain/document.js";
import { type FileQuery, type HistoryQuery, type ResultsQuery, type TreeQuery, type UnderstandResultsQuery, fileQuerySchema, historyQuerySchema, resultsQuerySchema, treeQuerySchema, understandResultsQuerySchema } from "./document.dto.js";

@ApiTags("delivery · documents")
@Controller("projects/:id")
@UseGuards(ProjectAccessGuard)
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly results: StageResultsService,
    private readonly gaps: GapAnswersService,
  ) {}

  @Post("applications/:appId/understand/gaps/answer")
  @RequirePermission("documents.resolve")
  @HttpCode(202)
  @ApiOperation({ summary: "Propose an answer in the original specification row; effective after its PR is merged" })
  answer(@Param("id") id: string, @Param("appId") appId: string, @Body({ schema: gapAnswerSchema }) body: GapAnswer, @CurrentActor() actor: Actor): Promise<DocumentWriteRecord> {
    return this.gaps.propose(id, appId, body, actor);
  }

  @Get("documents/refs")
  @ApiOperation({ summary: "Refs of the document repo: the default branch tip and the outputs of recent successful runs and writes (merged or open)" })
  @ApiOkResponse({ description: "The default branch and the refs, newest first." })
  refs(@Param("id") id: string): Promise<DocumentRefs> {
    return this.documents.refs(id);
  }

  @Get("documents/compare")
  @ApiOperation({
    summary: "Compare one file of the document repo at two commits: its unified diff with old and new line numbers; never restricted/ or .git",
    description: "from and to are commit ids of the mirror (the sha of a version from /documents/history). A file missing at one side is added or deleted; the same text at both gives status unchanged and no hunks. 413 over 2 MiB and 415 for a binary file, as /documents/file.",
  })
  @ApiOkResponse({ description: "The status, the counts of added and removed lines and the hunks." })
  compare(@Param("id") id: string, @Query({ schema: compareQuerySchema }) query: CompareQuery): Promise<DocumentCompare> {
    return this.documents.compare(id, query.path, query.from, query.to);
  }

  @Get("documents/tree")
  @ApiOperation({ summary: "List a directory of the document repo at a ref (default: the default branch); never restricted/ or .git" })
  @ApiOkResponse({ description: "The resolved commit and the entries (directories first)." })
  tree(@Param("id") id: string, @Query({ schema: treeQuerySchema }) query: TreeQuery): Promise<DocumentTree> {
    return this.documents.tree(id, query.ref, query.path);
  }

  @Get("documents/file")
  @ApiOperation({ summary: "Read a text file of the document repo at a ref (up to 2 MiB); never restricted/ or .git" })
  @ApiOkResponse({ description: "The file content; 413 when larger than 2 MiB, 415 when binary." })
  file(@Param("id") id: string, @Query({ schema: fileQuerySchema }) query: FileQuery): Promise<DocumentFile> {
    return this.documents.file(id, query.ref, query.path);
  }

  @Get("documents/history")
  @ApiOperation({
    summary: "The versions of a file of the document repo: the commits that changed it, newest first, following renames; never restricted/ or .git",
    description: "Each version has its commit, date, subject, actor (the Kintsugi-Actor trailer of a portal publish, else the commit author) and minor flag (the trailer Kintsugi-Minor: true). limit defaults to 50 (at most 200); pass the answer's next as before for the older versions. Only the newest 2,000 versions of a file are reached.",
  })
  @ApiOkResponse({ description: "The versions and the cursor of the next page; an empty list for a path no commit touched." })
  history(@Param("id") id: string, @Query({ schema: historyQuerySchema }) query: HistoryQuery): Promise<DocumentHistory> {
    return this.documents.history(id, query.ref, query.path, query.limit, query.before);
  }

  @Get("applications/:appId/stages/:stage/results")
  @ApiOperation({
    summary: "The results of a stage for an application (assess, map, extract-rules, harden, understand, gaps), built from its outputs in the document repo",
    description: "Default ref: the output of the stage's latest successful run (its branch tip), else the default branch. compare=true adds the previous successful run's counts.",
  })
  @ApiOkResponse({ description: "A stage-specific payload plus the raw Markdown of the main document." })
  stageResults(@Param("id") id: string, @Param("appId") appId: string, @Param("stage") stage: string, @Query({ schema: resultsQuerySchema }) query: ResultsQuery): Promise<StageResults> {
    return this.results.results(id, appId, stage, query.ref, query.compare);
  }

  @Get("applications/:appId/understand/results")
  @ApiOperation({
    summary: "The results of the understand stage (ADR-0033) as a view: map, extract-rules, harden, gaps or understand (traceability)",
    description: "Without item: the whole application (the generated views under generated/). With item: that catalog item's own files. Default ref: the default branch; a run's branch shows that run's items.",
  })
  @ApiOkResponse({ description: "A stage-results payload of the view (stage = the view) plus the scope." })
  understandResults(@Param("id") id: string, @Param("appId") appId: string, @Query({ schema: understandResultsQuerySchema }) query: UnderstandResultsQuery): Promise<StageResults> {
    return this.results.understandResults(id, appId, query.view, query.item, query.ref);
  }

  @Get("applications/:appId/results/headlines")
  @ApiOperation({ summary: "One or two headline numbers per result stage of an application, for the Delivery overview" })
  @ApiOkResponse({ description: "Per stage: the headline phrases and the ref they were read at." })
  headlines(@Param("id") id: string, @Param("appId") appId: string): Promise<StageHeadline[]> {
    return this.results.headlines(id, appId);
  }
}
