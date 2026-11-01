# services/knowledge

Placeholder, no code. The Knowledge Hub once planned here (ingestion of text chunks, embeddings in pgvector, a semantic search API) was never built, and [ADR-0091](../../docs/decisions/0091-brain-vectorless-tree-index.md) rejected it.

The project knowledge for members is the **Brain**: a vectorless tree index of the document repository, built by the worker (`services/orchestrator/src/brain`) and served by the API (`apps/api`, `delivery/brain`). See [docs/reference/brain.md](../../docs/reference/brain.md).
