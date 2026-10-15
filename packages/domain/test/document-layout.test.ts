import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS,
  DOCUMENT_PATH_TOKENS,
  appFromItemPath,
  appFromUnitPath,
  applicationDesignPath,
  applicationGatePath,
  applicationInputsDir,
  applicationRequirementsPath,
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
  topologyExtractorPath,
  unitAsIsPath,
  unitDesignPath,
  unitDir,
  unitGateReviewPath,
  unitId,
  unitRulesPath,
  unitRulesReviewPath,
  unitStatePath,
  unitTaskPath,
  unitTracePath,
  unitVerifyDir,
  verificationReportPath,
} from "../src/document-layout.js";

describe("ADR-0038 document-repo layout", () => {
  it("provides application paths and token forms used by job plans", () => {
    expect(applicationInputsDir("billing")).toBe("applications/billing/inputs");
    expect(applicationRequirementsPath("billing")).toBe("applications/billing/to-be/requirements.md");
    expect(applicationDesignPath("billing")).toBe("applications/billing/to-be/design.md");
    expect(applicationGatePath("billing", "G4")).toBe("applications/billing/gates/G4.md");
    expect(assessmentDir("billing")).toBe("applications/billing/assessment");
    expect(assessmentDir(DOCUMENT_PATH_TOKENS.app)).toBe("applications/{app}/assessment");
    expect(assessmentAnalysisDir(DOCUMENT_PATH_TOKENS.app)).toBe("applications/{app}/assessment/analysis");
    expect(assessmentCatalogDraftDir(DOCUMENT_PATH_TOKENS.app)).toBe("applications/{app}/assessment/catalog-draft");
    expect(assessmentCatalogPath(DOCUMENT_PATH_TOKENS.app)).toBe("applications/{app}/assessment/catalog.json");
    expect(topologyExtractorPath(DOCUMENT_PATH_TOKENS.app)).toBe("applications/{app}/assessment/tools/extract_topology.py");
    expect(assessmentBriefPath(DOCUMENT_PATH_TOKENS.app, "payroll/run-period")).toBe(
      "applications/{app}/units/payroll/run-period/as-is.md",
    );
  });

  it("extracts application ids from per-unit paths", () => {
    expect(appFromUnitPath("applications/web/units/payroll/run-period/rules.json")).toBe("web");
    expect(appFromItemPath("applications/web/units/payroll/run-period/meta.json")).toBe("web");
    expect(appFromUnitPath("applications/web/assessment/catalog.json")).toBeUndefined();
    expect(appFromUnitPath("applications/Bad_App/units/payroll/run-period/rules.json")).toBeUndefined();
  });

  it("keeps unit evidence and authored files beside the subject", () => {
    expect(assessmentItemFilePath("billing", "payroll/run-period", "rules.json")).toBe(
      "applications/billing/units/payroll/run-period/rules.json",
    );
    expect(knowledgeAsIsItemFilePath("billing", "payroll/run-period", "meta.json")).toBe(
      "applications/billing/units/payroll/run-period/meta.json",
    );
    expect(knowledgeAsIsUnitPath("billing", "payroll/run-period")).toBe(
      "applications/billing/units/payroll/run-period/as-is.md",
    );
    expect(unitId("billing", "payroll", "run-period")).toBe("billing/payroll/run-period");
    expect(unitDir("billing", "payroll", "run-period")).toBe("applications/billing/units/payroll/run-period");
    expect(unitStatePath("billing", "payroll", "run-period")).toBe(
      "applications/billing/units/payroll/run-period/unit.md",
    );
    expect(unitAsIsPath("billing", "payroll", "run-period")).toBe(
      "applications/billing/units/payroll/run-period/as-is.md",
    );
    expect(unitRulesPath("billing", "payroll", "run-period")).toBe(
      "applications/billing/units/payroll/run-period/rules.json",
    );
    expect(unitRulesReviewPath("billing", "payroll", "run-period")).toBe(
      "applications/billing/units/payroll/run-period/rules-review.json",
    );
    expect(unitTracePath("billing", "payroll", "run-period")).toBe(
      "applications/billing/units/payroll/run-period/trace.json",
    );
    expect(unitTaskPath("billing", "payroll", "run-period")).toBe(
      "applications/billing/units/payroll/run-period/task.md",
    );
    expect(unitDesignPath("billing", "payroll", "run-period")).toBe(
      "applications/billing/units/payroll/run-period/design.md",
    );
    expect(unitGateReviewPath("billing", "payroll", "run-period")).toBe(
      "applications/billing/units/payroll/run-period/reviews/G4.md",
    );
    expect(unitVerifyDir("billing", "payroll", "run-period")).toBe(
      "applications/billing/units/payroll/run-period/verify",
    );
  });

  it("keeps application aggregates and legacy helper names in the new tree", () => {
    expect(generatedDir("billing")).toBe("applications/billing/generated");
    expect(knowledgeAsIsGeneratedFilePath("billing", "traceability.json")).toBe(
      "applications/billing/generated/traceability.json",
    );
    expect(legacyUnitsIndexPath("billing")).toBe("applications/billing/assessment/units.json");
    expect(modernizationBriefPath("billing")).toBe("applications/billing/inputs/INTENT.md");
    expect(verificationReportPath("billing")).toBe("applications/billing/generated/VERIFICATION.md");
    expect(verificationReportPath("billing", "json")).toBe("applications/billing/generated/VERIFICATION.json");
    expect(goldenDir("payroll")).toBe("applications/{app}/units/payroll/{unit}/verify/golden");
    expect(runsDir("payroll", "run-01")).toBe("applications/{app}/units/payroll/{unit}/verify/runs/run-01");
    expect(taskPackPath("payroll/run-period")).toBe("applications/{app}/units/payroll/run-period/task.md");
    expect(reviewsDir("payroll/run-period")).toBe("applications/{app}/units/payroll/run-period/reviews");
  });

  it("uses only unit state, task, and generated paths as auto-commit defaults", () => {
    expect(DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS).toEqual([
      "applications/*/units/**/unit.md",
      "applications/*/units/**/task.md",
      "applications/*/generated/**",
    ]);
  });
});
