# ADR-0010: PostgreSQL is the only datastore

- Status: Accepted. Amended by [ADR-0014](0014-no-code-graph-no-agent-config.md): no KB graph (entity / edge tables removed).
- Date: 2026-10-09

## Decision
- PostgreSQL 16+ with the **pgvector** extension holds everything that is not in Git:
  - operational data
  - KB index: text chunks + embeddings
  - job queue (ADR-0003)
  - job events and outbox
  - usage and cost
  - audit (append-only, hash-chained)
  - encrypted secrets
- Live updates to the portal use `LISTEN/NOTIFY` and SSE. There is no separate message broker.

## Consequences
- One stateful service to install and back up.
- Revisit a dedicated graph or vector store only when measured query needs exceed Postgres.
