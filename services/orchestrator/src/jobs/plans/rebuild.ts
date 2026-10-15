// The aggregate rebuild (ADR-0033): a script-only plan that regenerates application-wide views
// from merged per-unit files. The domain layout module owns both generated paths; the writer
// commits them directly after merge, while per-unit files arrive in their own pull request. Started
// by the worker after a merge that touches an application's items, and by the portal's Rebuild action.
import { DOCUMENT_PATH_TOKENS, assessmentCatalogPath, assessmentDir, generatedFilePath, knowledgeAsIsDir, knowledgeAsIsGeneratedFilePath } from "@kintsugi/domain";
import type { StagePlan } from "../plan.js";

const APP_TOKEN = DOCUMENT_PATH_TOKENS.app;

export const REBUILD: StagePlan = {
  id: "rebuild",
  message: (app) => `Rebuild the generated views of ${app} from its understood items`,
  documents: [`${assessmentDir(APP_TOKEN)}/`, `${knowledgeAsIsDir(APP_TOKEN)}/`],
  requires: [{ path: assessmentCatalogPath(APP_TOKEN), stage: "assess" }],
  steps: [
    {
      id: "aggregates",
      kind: "script",
      script: "rebuild_aggregates.py",
      args: ["{app}", "--docs", "{in}", "--out", "{out}"],
      expects: [generatedFilePath(APP_TOKEN, "topology.json"), knowledgeAsIsGeneratedFilePath(APP_TOKEN, "traceability.json")],
    },
  ],
};
