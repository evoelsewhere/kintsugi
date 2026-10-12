// The aggregate rebuild (ADR-0033): a script-only stage that regenerates the whole-application
// views of an application from its per-item files on the default branch —
// assessment/<app>/generated/ (topology, rules, data objects, security findings) and
// knowledge/as-is/<app>/generated/ (traceability, index). Its outputs are all under the default
// `autoCommitPaths` (`assessment/**/generated/**`, `knowledge/**/generated/**`), so the writer
// commits them to the default branch without a pull request. Started by the worker when the mirror
// sync sees a new default-branch tip that touches an application's items/ (aggregates.ts), and by
// the portal's Rebuild action.

import type { StagePlan } from "../plan.js";

export const REBUILD: StagePlan = {
  id: "rebuild",
  message: (app) => `Rebuild the generated views of ${app} from its understood items`,
  documents: ["assessment/{app}/", "knowledge/as-is/{app}/"],
  requires: [{ path: "assessment/{app}/catalog.json", stage: "assess" }],
  steps: [
    {
      id: "aggregates",
      kind: "script",
      script: "rebuild_aggregates.py",
      args: ["{app}", "--docs", "{in}", "--out", "{out}"],
      expects: ["assessment/{app}/generated/topology.json", "knowledge/as-is/{app}/generated/traceability.json"],
    },
  ],
};
