import { describe, expect, it } from "vitest";
import * as layout from "../src/document-layout.js";
import {
  DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS,
  DOCUMENT_PATH_TOKENS,
  appFromUnitPath,
  applicationDesignPath,
  applicationGatePath,
  applicationInputsDir,
  applicationRequirementsPath,
  assessmentAnalysisDir,
  assessmentBriefPath,
  assessmentCatalogModulePath,
  assessmentCatalogPath,
  assessmentDir,
  assessmentInventoryPath,
  assessmentTopologyPath,
  generatedDir,
  goldenDir,
  modernizationBriefPath,
  reviewsDir,
  runsDir,
  scratchCatalogDraftDir,
  scratchInventoryPath,
  scratchTopologyPath,
  taskPackPath,
  topologyExtractorPath,
  transformationNotesPath,
  understandPlanPath,
  understandRunDir,
  understandScopePath,
  understandTraceDraftPath,
  unitAsIsPath,
  unitDesignPath,
  unitDir,
  unitFindingsPath,
  unitGateReviewPath,
  unitId,
  unitKeyAsIsPath,
  unitKeyUnderstandingPath,
  unitRulesPath,
  unitRulesReviewPath,
  unitStatePath,
  unitTaskPath,
  unitTopologyPath,
  unitTracePath,
  unitUnderstandingPath,
  unitVerifyDir,
  verificationReportPath,
} from "../src/document-layout.js";

const APP = DOCUMENT_PATH_TOKENS.app;

describe("ADR-0042 document-repo layout", () => {
  it("groups the Assessment context under assessment/", () => {
    expect(applicationInputsDir("billing")).toBe("applications/billing/inputs");
    expect(applicationRequirementsPath("billing")).toBe("applications/billing/to-be/requirements.md");
    expect(applicationDesignPath("billing")).toBe("applications/billing/to-be/design.md");
    expect(applicationGatePath("billing", "G4")).toBe("applications/billing/gates/G4.md");
    expect(assessmentDir("billing")).toBe("applications/billing/assessment");
    expect(assessmentDir(APP)).toBe("applications/{app}/assessment");
    expect(assessmentInventoryPath(APP)).toBe("applications/{app}/assessment/inventory.md");
    expect(assessmentTopologyPath(APP)).toBe("applications/{app}/assessment/topology.md");
    expect(assessmentCatalogPath(APP)).toBe("applications/{app}/assessment/catalog/index.md");
    expect(assessmentCatalogModulePath(APP, "invoicing")).toBe("applications/{app}/assessment/catalog/invoicing.md");
    expect(assessmentAnalysisDir(APP)).toBe("applications/{app}/assessment/analysis");
    expect(topologyExtractorPath(APP)).toBe("applications/{app}/assessment/tools/extract_topology.py");
  });

  it("keeps job-to-job data in scratch, outside the layout", () => {
    expect(scratchInventoryPath(APP)).toBe("scratch/{app}/inventory.json");
    expect(scratchTopologyPath(APP)).toBe("scratch/{app}/topology.json");
    expect(scratchCatalogDraftDir(APP)).toBe("scratch/{app}/catalog-draft");
    expect(understandRunDir(APP)).toBe("scratch/{app}/understand");
    expect(understandScopePath("billing")).toBe("scratch/billing/understand/scope.json");
    expect(assessmentBriefPath(APP, "payroll/run-period")).toBe("scratch/{app}/understand/briefs/payroll/run-period.json");
    expect(understandTraceDraftPath(APP, "payroll/run-period")).toBe("scratch/{app}/understand/trace/payroll/run-period.json");
  });

  it("puts the plan in the Understanding context", () => {
    expect(understandPlanPath("billing")).toBe("applications/billing/understanding/plan.md");
  });

  it("extracts application ids from per-unit paths", () => {
    expect(appFromUnitPath("applications/web/units/payroll/run-period/understanding/rules.md")).toBe("web");
    expect(appFromUnitPath("applications/web/assessment/catalog/index.md")).toBeUndefined();
    expect(appFromUnitPath("applications/Bad_App/units/payroll/run-period/understanding/rules.md")).toBeUndefined();
  });

  it("makes the unit the aggregate: unit.md is the root, understanding/ holds what is known", () => {
    const base = "applications/billing/units/payroll/run-period";
    expect(unitId("billing", "payroll", "run-period")).toBe("billing/payroll/run-period");
    expect(unitDir("billing", "payroll", "run-period")).toBe(base);
    expect(unitStatePath("billing", "payroll", "run-period")).toBe(`${base}/unit.md`);
    expect(unitAsIsPath("billing", "payroll", "run-period")).toBe(`${base}/understanding/as-is.md`);
    expect(unitKeyAsIsPath("billing", "payroll/run-period")).toBe(`${base}/understanding/as-is.md`);
    expect(unitUnderstandingPath("billing", "payroll", "run-period")).toBe(`${base}/understanding/understanding.md`);
    expect(unitRulesPath("billing", "payroll", "run-period")).toBe(`${base}/understanding/rules.md`);
    expect(unitRulesReviewPath("billing", "payroll", "run-period")).toBe(`${base}/understanding/rules-review.md`);
    expect(unitFindingsPath("billing", "payroll", "run-period")).toBe(`${base}/understanding/findings.md`);
    expect(unitTopologyPath("billing", "payroll", "run-period")).toBe(`${base}/understanding/topology.md`);
    expect(unitTracePath("billing", "payroll", "run-period")).toBe(`${base}/understanding/trace.md`);
    expect(unitKeyUnderstandingPath("billing", "payroll/run-period", "trace.md")).toBe(`${base}/understanding/trace.md`);
    expect(unitTaskPath("billing", "payroll", "run-period")).toBe(`${base}/task.md`);
    expect(unitDesignPath("billing", "payroll", "run-period")).toBe(`${base}/design.md`);
    expect(unitGateReviewPath("billing", "payroll", "run-period")).toBe(`${base}/reviews/G4.md`);
    expect(unitVerifyDir("billing", "payroll", "run-period")).toBe(`${base}/verify`);
  });

  it("keeps the read models and the later-phase helpers where they were", () => {
    expect(generatedDir("billing")).toBe("applications/billing/generated");
    expect(modernizationBriefPath("billing")).toBe("applications/billing/to-be/modernization-brief.md");
    expect(transformationNotesPath("billing", "payroll")).toBe("applications/billing/units/payroll/TRANSFORMATION_NOTES.md");
    expect(verificationReportPath("billing")).toBe("applications/billing/generated/VERIFICATION.md");
    expect(goldenDir("payroll")).toBe("applications/{app}/units/payroll/{unit}/verify/golden");
    expect(runsDir("payroll", "run-01")).toBe("applications/{app}/units/payroll/{unit}/verify/runs/run-01");
    expect(taskPackPath("payroll/run-period")).toBe("applications/{app}/units/payroll/run-period/task.md");
    expect(reviewsDir("payroll/run-period")).toBe("applications/{app}/units/payroll/run-period/reviews");
  });

  it("uses only unit state, task, generated and the understanding plan as auto-commit defaults", () => {
    expect(DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS).toEqual([
      "applications/*/units/**/unit.md",
      "applications/*/units/**/task.md",
      "applications/*/generated/**",
      "applications/*/understanding/plan.md",
    ]);
  });

  it("returns no .json path for a committed document (scratch and the testing context aside)", () => {
    const app = "billing";
    const committed = [
      layout.assessmentInventoryPath(app),
      layout.assessmentTopologyPath(app),
      layout.assessmentCatalogPath(app),
      layout.assessmentCatalogModulePath(app, "invoicing"),
      layout.understandPlanPath(app),
      layout.unitUnderstandingPath(app, "invoicing", "entry"),
      layout.unitRulesPath(app, "invoicing", "entry"),
      layout.unitRulesReviewPath(app, "invoicing", "entry"),
      layout.unitFindingsPath(app, "invoicing", "entry"),
      layout.unitTopologyPath(app, "invoicing", "entry"),
      layout.unitTracePath(app, "invoicing", "entry"),
    ];
    for (const path of committed) expect(path.endsWith(".json")).toBe(false);
    for (const path of DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS) expect(path.endsWith(".json")).toBe(false);
  });
});
