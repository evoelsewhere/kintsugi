# services/knowledge

Knowledge Hub. Sources are files in Git (code repos + workspace repo); the index lives in Postgres and can be rebuilt from Git (ADR-0007, ADR-0010).

- Ingestion: source files and documents chunked as text (no code parsing or graph, ADR-0014), xlsx/docx → md (D15), KT recording transcripts, DB schema exports; orchestrates the `knowledge-ingest` runtime agent.
- Index: chunks + embeddings (pgvector), entities and edges (plain tables, recursive CTE). Every entry references `repo@commit:path`.
- Search API (semantic + full-text) used by the portal, the runtime `kb.search` tool and the Kintsugi MCP server in `services/harness-hub`.
