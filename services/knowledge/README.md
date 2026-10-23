# services/knowledge

Knowledge Hub. Sources are files in Git (code repos + document repo); the index lives in Postgres and can be rebuilt from Git (ADR-0007, ADR-0010).

- Ingestion: source files and documents chunked as text (no code parsing or graph, ADR-0014), xlsx/docx → md (D15), KT recording transcripts, DB schema exports; will orchestrate a planned `knowledge-ingest` runtime agent (none ships yet, ADR-0023).
- Index: chunks + embeddings (pgvector), entities and edges (plain tables, recursive CTE). Every entry references `repo@commit:path`.
- Search API (semantic + full-text) used by the portal, a planned runtime kernel tool for knowledge-base search.
