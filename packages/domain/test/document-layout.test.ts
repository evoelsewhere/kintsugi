import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS,
  DOCUMENT_PATH_TOKENS,
  appFromItemPath,
  assessmentAnalysisDir,
  assessmentBriefPath,
  assessmentCatalogDraftDir,
  assessmentCatalogPath,
  assessmentDir,
  assessmentItemFilePath,
  generatedDir,
  goldenDir,
  knowledgeAsIsGeneratedFilePath,
  knowledgeAsIsItemFilePath,
  knowledgeAsIsUnitPath,
  legacyUnitsIndexPath,
  modernizationBriefPath,
  reviewsDir,
  runsDir,
  taskPackPath,
  transformationNotesPath,
  topologyExtractorPath,
  unitDir,
  unitId,
  unitStatePath,
  verificationReportPath,
} from "../src/document-layout.js";

describe("current document-repo layout", () => {
  it("provides the application path and the token form used by job plans", () => {
    expect(assessmentDir("billing")).toBe("assessment/billing");
    expect(assessmentDir(DOCUMENT_PATH_TOKENS.app)).toBe("assessment/{app}");
    expect(assessmentAnalysisDir(DOCUMENT_PATH_TOKENS.app)).toBe("assessment/{app}/analysis");
    expect(assessmentCatalogDraftDir(DOCUMENT_PATH_TOKENS.app)).toBe("assessment/{app}/catalog-draft");
    expect(assessmentCatalogPath(DOCUMENT_PATH_TOKENS.app)).toBe("assessment/{app}/catalog.json");
    expect(topologyExtractorPath(DOCUMENT_PATH_TOKENS.app)).toBe("assessment/{app}/tools/extract_topology.py");
    expect(assessmentBriefPath(DOCUMENT_PATH_TOKENS.app, DOCUMENT_PATH_TOKENS.unit)).toBe("assessment/{app}/understand/briefs/{unit}.json");
  });

  it("extracts the application id from current per-item evidence paths", () => {
    expect(appFromItemPath("assessment/web/items/payroll/run-period/rules.json")).toBe("web");
    expect(appFromItemPath("knowledge/as-is/web/items/payroll/run-period/meta.json")).toBe("web");
    expect(appFromItemPath("assessment/web/catalog.json")).toBeUndefined();
    expect(appFromItemPath("assessment/Bad_App/items/payroll/run-period/rules.json")).toBeUndefined();
  });

  it("keeps every current per-unit path in one subject layout", () => {
    expect(assessmentItemFilePath("billing", "payroll/run-period", "rules.json")).toBe("assessment/billing/items/payroll/run-period/rules.json");
    expect(knowledgeAsIsItemFilePath("billing", "payroll/run-period", "meta.json")).toBe("knowledge/as-is/billing/items/payroll/run-period/meta.json");
    expect(knowledgeAsIsUnitPath("billing", "payroll/run-period")).toBe("knowledge/as-is/billing/payroll/run-period.md");
    expect(unitId("billing", "payroll", "run-period")).toBe("billing/payroll/run-period");
    expect(unitDir("billing", "payroll", "run-period")).toBe("units/billing/payroll/run-period");
    expect(unitStatePath("billing", "payroll", "run-period")).toBe("units/billing/payroll/run-period.md");
  });

  it("keeps current aggregate and member workflow locations", () => {
    expect(generatedDir("billing")).toBe("assessment/billing/generated");
    expect(knowledgeAsIsGeneratedFilePath("billing", "traceability.json")).toBe("knowledge/as-is/billing/generated/traceability.json");
    expect(legacyUnitsIndexPath("billing")).toBe("knowledge/as-is/billing/units.json");
    expect(modernizationBriefPath("billing")).toBe("assessment/billing/MODERNIZATION_BRIEF.md");
    expect(transformationNotesPath("billing", "payroll")).toBe("assessment/billing/modules/payroll/TRANSFORMATION_NOTES.md");
    expect(verificationReportPath("billing")).toBe("assessment/billing/VERIFICATION.md");
    expect(verificationReportPath("billing", "json")).toBe("assessment/billing/VERIFICATION.json");
    expect(goldenDir("payroll")).toBe("golden/payroll");
    expect(runsDir("payroll", "run-01")).toBe("runs/payroll/run-01");
    expect(taskPackPath("task-01")).toBe("tasks/task-01.md");
    expect(reviewsDir("unit-01")).toBe("reviews/unit-01");
  });

  it("owns the existing auto-commit patterns", () => {
    expect(DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS).toEqual([
      "units/**",
      "tasks/**",
      "knowledge/**/generated/**",
      "assessment/**/generated/**",
    ]);
  });
});
