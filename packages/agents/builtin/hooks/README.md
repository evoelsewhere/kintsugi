# Hooks and portal readers

This directory contains two different kinds of code:

- [`job_output.py`](job_output.py) implements the server-side **JobOutput** lifecycle check. Configure the job lifecycle to invoke it as a standard script step on the job's output directory before that output is eligible for commit. Its contract and report format are specified in [JOB-OUTPUT.md](JOB-OUTPUT.md).
- [`reader/`](reader/) contains pure TypeScript readers that derive a progress snapshot from repository artifacts. These functions have no plugin-host, runtime-kernel, filesystem-host, or UI imports. They are retained as the data layer for a future portal progress panel; the portal supplies a read-only `ReaderFs` adapter and chooses how to render the returned data.

The reader understands the workspace namespaces `assessment/<app>/`, `golden/<unit>/`, and `runs/<unit>/<run-id>/`, plus routed `source/<app>/` and `target/<app>/` roots. The source namespace represents the legacy repository at its pinned revision and is read-only. `reader/layout.ts` centralizes these paths; `reader/progress.ts` reads assessment evidence, the source tree, and target-track output. Golden/run path helpers are provided for portal consumers; run output remains ephemeral and is not committed.

There is no `hooks.json`, plugin registration, pane renderer, telemetry, or host API in this package. The readers do not draw a pane or perform writes. TypeScript reader tests live in `../tests/reader.test.ts`, are included in the `@kintsugi/agents` Vitest suite and builtin TypeScript config, and run with `pnpm --filter @kintsugi/agents test` / `pnpm --filter @kintsugi/agents typecheck`. Python lifecycle-hook tests are in `hooks/tests/` and run with `python -m pytest -q packages/agents/builtin/hooks/tests` from the repository root.
