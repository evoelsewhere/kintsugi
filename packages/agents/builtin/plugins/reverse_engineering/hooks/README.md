# Hooks and portal readers

This directory contains two different kinds of code:

- [`job_output.py`](job_output.py) implements the server-side **JobOutput** lifecycle check. Configure the job lifecycle to invoke it as a standard script step on the job's output directory before that output is eligible for commit. Its contract and report format are specified in [JOB-OUTPUT.md](JOB-OUTPUT.md).
- [`reader/`](reader/) contains pure TypeScript readers of the artifacts the stages commit to the document repo (inventory, topology, catalog, rules, findings, traceability, plan, design sets). These functions have no plugin-host, runtime-kernel, filesystem-host, or UI imports. They are the data layer of the portal's stage results: `reader/index.ts` is built to `dist/reader` and exported as `@kintsugi/agents/reader`, and the API reads the stage outputs from the document repo mirror with these parsers.

There is no `hooks.json`, plugin registration, pane renderer, telemetry, or host API in this package. The readers do not draw a pane or perform writes. TypeScript reader tests live in `../tests/reader.test.ts`, are included in the `@kintsugi/agents` Vitest suite and builtin TypeScript config, and run with `pnpm --filter @kintsugi/agents test` / `pnpm --filter @kintsugi/agents typecheck`. Python lifecycle-hook tests are in `hooks/tests/` and run with `python -m pytest -q packages/agents/builtin/plugins/reverse_engineering/hooks/tests` from the repository root.
