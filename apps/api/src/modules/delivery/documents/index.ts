// Public surface of the documents module: other modules import only from here.

export { DocumentsModule } from "./documents.module.js";
export { DocumentsService, type DocumentContext } from "./application/documents.service.js";
export { StageResultsService } from "./application/stage-results.service.js";
export type { DocumentFile, DocumentRef, DocumentRefs, DocumentTree, GrepLine, StageHeadline, StageResults } from "./domain/document.js";
