// Interface layer: read-only document repo content from Kintsugi's mirror (ADR-0025, ADR-0028)
// and the results of a stage built from it. A session is enough (no permission): the documents
// are what the project shares; restricted records are never committed and never served here.

import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { DocumentsService } from "../application/documents.service.js";
import { StageResultsService } from "../application/stage-results.service.js";
import type { DocumentFile, DocumentRefs, DocumentTree, StageHeadline, StageResults } from "../domain/document.js";
import { type FileQuery, type ResultsQuery, type TreeQuery, fileQuerySchema, resultsQuerySchema, treeQuerySchema } from "./document.dto.js";

@ApiTags("delivery · documents")
@Controller("projects/:id")
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly results: StageResultsService,
  ) {}

  @Get("documents/refs")
  @ApiOperation({ summary: "Refs of the document repo: the default branch tip and the outputs of recent successful runs and writes (merged or open)" })
  @ApiOkResponse({ description: "The default branch and the refs, newest first." })
  refs(@Param("id") id: string): Promise<DocumentRefs> {
    return this.documents.refs(id);
  }

  @Get("documents/tree")
  @ApiOperation({ summary: "List a directory of the document repo at a ref (default: the default branch); never restricted/ or .git" })
  @ApiOkResponse({ description: "The resolved commit and the entries (directories first)." })
  tree(@Param("id") id: string, @Query({ schema: treeQuerySchema }) query: TreeQuery): Promise<DocumentTree> {
    return this.documents.tree(id, query.ref, query.path);
  }

  @Get("documents/file")
  @ApiOperation({ summary: "Read a text file of the document repo at a ref (up to 2 MiB; .json is parsed too); never restricted/ or .git" })
  @ApiOkResponse({ description: "The file content; 413 when larger than 2 MiB, 415 when binary." })
  file(@Param("id") id: string, @Query({ schema: fileQuerySchema }) query: FileQuery): Promise<DocumentFile> {
    return this.documents.file(id, query.ref, query.path);
  }

  @Get("applications/:appId/stages/:stage/results")
  @ApiOperation({
    summary: "The results of a stage for an application (assess, map, extract-rules, harden), built from its outputs in the document repo",
    description: "Default ref: the output of the stage's latest successful run (its branch tip), else the default branch. compare=true adds the previous successful run's counts.",
  })
  @ApiOkResponse({ description: "A stage-specific payload plus the raw Markdown of the main document." })
  stageResults(@Param("id") id: string, @Param("appId") appId: string, @Param("stage") stage: string, @Query({ schema: resultsQuerySchema }) query: ResultsQuery): Promise<StageResults> {
    return this.results.results(id, appId, stage, query.ref, query.compare);
  }

  @Get("applications/:appId/results/headlines")
  @ApiOperation({ summary: "One or two headline numbers per result stage of an application, for the Delivery overview" })
  @ApiOkResponse({ description: "Per stage: the headline phrases and the ref they were read at." })
  headlines(@Param("id") id: string, @Param("appId") appId: string): Promise<StageHeadline[]> {
    return this.results.headlines(id, appId);
  }
}
