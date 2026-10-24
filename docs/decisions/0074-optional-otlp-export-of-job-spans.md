# ADR-0074: Optional OTLP export of job spans

- Status: Accepted (builds on [ADR-0048](0048-runtime-telemetry-compaction-and-prompt-cache.md), [ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md))
- Date: 2026-10-24
- Decision register: D88

## Context

[ADR-0048](0048-runtime-telemetry-compaction-and-prompt-cache.md) made the kernel emit spans (job, turn, tool, compaction, retry) and the worker store them in `monitoring.telemetry_span`; Governance → Telemetry reads that table. It left an OpenTelemetry exporter out "until a deployment needs it". Deployments that already run an observability backend (an OpenTelemetry collector, Langfuse, Grafana Tempo) want the same traces there, next to their other services, without Kintsugi shipping a dashboard for every tool.

The packages that pi's package directory offers for this (for example a Langfuse plugin) are extensions of the interactive pi agent. They hook the session themselves, would measure what the kernel already measures, and trace prompts and tool output, which ADR-0048 keeps out of spans.

## Decision

1. **The spans of ADR-0048 are exported as they are**, over OTLP/HTTP with the JSON encoding, to an endpoint an administrator sets. Nothing new is measured: the exporter is one more consumer of the spans the worker already receives, so Governance → Telemetry and the backend show the same numbers. Attributes stay scalars (counts, sizes, names); no prompt, tool argument or tool output leaves.
2. **The worker exports, not the job process.** A job child has no credentials in its environment ([ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md)) and a killed child loses its last events; the worker already holds the batch of spans (`flushSpans`) and the secret key. After storing a batch it hands it to the exporter, which never waits for the backend inside the job and never fails the job: a slow or unreachable backend loses spans, logs a line, and the stored spans in Postgres stay the record.
3. **Off by default, configured in the portal.** Settings → Telemetry export (permission `telemetry.manage`, admin by default) stores `enabled`, the endpoint and the `service.name` in `admin.installation_setting` under `telemetry-export`. The headers a backend needs (an API key, a `Basic` credential) are stored encrypted with `KINTSUGI_SECRET_KEY` in the same value ([ADR-0009](0009-llm-provider-config.md)); the API returns only their names. The worker reads the setting when it exports and caches it for a few seconds, so a change applies without a restart. No environment variable configures it.
4. **Mapping.** One trace per job run (the trace id is derived from the run id), so retries and the steps of a stage land in one trace; the span id is derived from the run, step, attempt and the kernel's span id, so a batch sent twice does not duplicate a span. The resource carries `service.name`; each span carries the project, application, run, step, agent, provider, model and attempt as `kintsugi.*` attributes next to its own. Times are the kernel's start time and duration. A span that ended in error has status `error` with the (already cut) message.
5. **No new dependency.** The OTLP JSON body is a small fixed shape and is sent with `fetch`; the OpenTelemetry SDK is not added to the worker. A collector in front of the backend can convert to any other protocol.
6. **The endpoint is an outbound request from the worker** to a URL an administrator typed. Only users with `telemetry.manage` can set it, an endpoint with credentials in the URL is refused (a header carries them), every change is audited with the endpoint and header names (never values), and the request has a short timeout.

## Consequences

- A backend that speaks OTLP/HTTP JSON (a collector, Tempo, Langfuse's OTLP endpoint) receives the traces. A backend that accepts only protobuf needs a collector in front. Check the target backend's accepted encodings before relying on it.
- Spans of the running job reach the backend in batches of up to 100 as they arrive, not at the end; an export in flight when the worker stops may be lost.
- Retention and the Governance → Telemetry views are unchanged. Turning the export off stops new spans only; nothing is deleted from the backend.
- If pi starts emitting its own spans ([ADR-0048](0048-runtime-telemetry-compaction-and-prompt-cache.md)), the mapping stays in the worker and the kernel adapter is the seam where they are reconciled.

## Alternatives considered

- **Install a pi observability plugin** (Langfuse, Braintrust, LangSmith). Rejected: they instrument an interactive pi session, duplicate what the kernel measures, and send prompt and output content.
- **Export from the job process.** Rejected: it needs the key in a process that must not have credentials, and a killed child loses the batch.
- **Configure the endpoint by environment variables.** Rejected: provider-like settings live in the database and are managed in the portal.
- **The OpenTelemetry Node SDK in the worker.** Rejected for now: a heavy dependency tree for one fixed JSON body; revisit if gRPC or protobuf is needed.
