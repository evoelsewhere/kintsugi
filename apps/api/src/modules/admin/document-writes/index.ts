// Public surface of the document writes module: other modules import only from here.

export { DocumentWritesModule } from "./document-writes.module.js";
export { DocumentWritesService } from "./application/document-writes.service.js";
export type { DocumentWriteRecord, DocumentWriteStatus } from "./domain/document-write.js";
