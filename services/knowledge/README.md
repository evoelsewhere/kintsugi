# services/knowledge

Knowledge Hub. Sources are files in Git (code repos + workspace repo); the index lives in Postgres and can be rebuilt from Git (ADR-0007, ADR-0010).

- Ingestion: source code parsing (D14), xlsx/docx → md (D15), KT recording transcripts, DB schema; orchestrates the `knowledge-ingest` runtime agent.
- Index: chunks + embeddings (pgvector), entities and edges (plain tables, recursive CTE). Every entry references `repo@commit:path`.
- Search API used by the portal, runtime tools (`kb.search`, `kb.graph`) and the Kintsugi MCP server in `services/harness-hub`.
