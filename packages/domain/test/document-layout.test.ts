import { describe, expect, it } from "vitest";
import * as layout from "../src/document-layout.js";
import {
  DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS,
  DOCUMENT_PATH_TOKENS,
  appFromUnitPath,
  applicationDesignDir,
  applicationDesignFilePath,
  applicationDesignPath,
  applicationDesignSetDir,
  applicationInputsDir,
  applicationRequirementsPath,
  architectureDir,
  assessmentAnalysisDir,
  assessmentBriefPath,
  assessmentCatalogModulePath,
  assessmentCatalogPath,
  assessmentDiagramPath,
  assessmentDir,
  assessmentInventoryPath,
  assessmentSynthesisPath,
  assessmentTopologyPath,
  commonComponentPath,
  commonComponentsDir,
  designManifestPath,
  designReportPath,
  designRunDir,
  designSetDir,
  designSetPath,
  designSetsDir,
  designTemplatePath,
  generatedDir,
  glossaryPath,
  isUnitSegment,
  legacyDir,
  modernDir,
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
  unitDesignFilePath,
  unitDesignSetDir,
  unitFindingsPath,
  unitId,
  unitKeyAsIsPath,
  unitKeyDesignSetDir,
  unitKeyLegacyPath,
  unitLegacyDir,
  unitModernDir,
  unitRuleFilePath,
  unitRulesDir,
  unitRulesPath,
  unitRulesReviewPath,
  unitStatePath,
  unitTaskPath,
  unitTopologyPath,
  unitTracePath,
  unitUnderstandingPath,
} from "../src/document-layout.js";

const APP = DOCUMENT_PATH_TOKENS.app;

describe("ADR-0051 document-repo layout", () => {
  it("numbers the root folders and keeps the glossary with the project", () => {
    expect(glossaryPath()).toBe("00-project/glossary.md");
    expect(designSetsDir()).toBe("01-standards/templates");
    expect(architectureDir()).toBe("02-architecture");
  });

  it("splits an application into inputs, a legacy half and a modern half", () => {
    expect(applicationInputsDir("billing")).toBe("10-applications/billing/00-inputs");
    expect(legacyDir("billing")).toBe("10-applications/billing/01-legacy");
    expect(modernDir("billing")).toBe("10-applications/billing/02-modern");
    expect(applicationRequirementsPath("billing")).toBe("10-applications/billing/02-modern/requirements.md");
    expect(applicationDesignPath("billing")).toBe("10-applications/billing/02-modern/design.md");
    expect(generatedDir("billing")).toBe("10-applications/billing/_generated");
  });

  it("puts the assessment at the top of the legacy half, with _-prefixed folders", () => {
    expect(assessmentDir(APP)).toBe("10-applications/{app}/01-legacy");
    expect(assessmentInventoryPath(APP)).toBe("10-applications/{app}/01-legacy/inventory.md");
    expect(assessmentTopologyPath(APP)).toBe("10-applications/{app}/01-legacy/topology.md");
    expect(assessmentSynthesisPath(APP)).toBe("10-applications/{app}/01-legacy/assessment.md");
    expect(assessmentDiagramPath(APP)).toBe("10-applications/{app}/01-legacy/architecture.mmd");
    expect(assessmentCatalogPath(APP)).toBe("10-applications/{app}/01-legacy/_catalog/index.md");
    expect(assessmentCatalogModulePath(APP, "invoicing")).toBe("10-applications/{app}/01-legacy/_catalog/invoicing.md");
    expect(assessmentAnalysisDir(APP)).toBe("10-applications/{app}/01-legacy/_analysis");
    expect(topologyExtractorPath(APP)).toBe("10-applications/{app}/01-legacy/_tools/extract_topology.py");
    expect(understandPlanPath("billing")).toBe("10-applications/billing/01-legacy/plan.md");
  });

  it("keeps job-to-job data in scratch, outside the layout", () => {
    expect(scratchInventoryPath(APP)).toBe("scratch/{app}/inventory.json");
    expect(scratchTopologyPath(APP)).toBe("scratch/{app}/topology.json");
    expect(scratchCatalogDraftDir(APP)).toBe("scratch/{app}/catalog-draft");
    expect(understandRunDir(APP)).toBe("scratch/{app}/understand");
    expect(designRunDir(APP)).toBe("scratch/{app}/design");
    expect(designManifestPath("billing")).toBe("scratch/billing/design/manifest.json");
    expect(designReportPath("billing")).toBe("scratch/billing/design/report.json");
    expect(understandScopePath("billing")).toBe("scratch/billing/understand/scope.json");
    expect(assessmentBriefPath(APP, "payroll/run-period")).toBe("scratch/{app}/understand/briefs/payroll/run-period.json");
    expect(understandTraceDraftPath(APP, "payroll/run-period")).toBe("scratch/{app}/understand/trace/payroll/run-period.json");
  });

  it("extracts application ids from per-unit paths of either half", () => {
    expect(appFromUnitPath("10-applications/web/01-legacy/payroll/run-period/rules.md")).toBe("web");
    expect(appFromUnitPath("10-applications/web/02-modern/payroll/run-period/README.md")).toBe("web");
    expect(appFromUnitPath("10-applications/web/01-legacy/_catalog/index.md")).toBeUndefined();
    expect(appFromUnitPath("10-applications/web/02-modern/_design/arch/overview.md")).toBeUndefined();
    expect(appFromUnitPath("10-applications/web/01-legacy/inventory.md")).toBeUndefined();
    expect(appFromUnitPath("10-applications/web/02-modern/payroll/TRANSFORMATION_NOTES.md")).toBeUndefined();
    expect(appFromUnitPath("10-applications/Bad_App/01-legacy/payroll/run-period/rules.md")).toBeUndefined();
    expect(isUnitSegment("payroll")).toBe(true);
    expect(isUnitSegment("_catalog")).toBe(false);
  });

  it("keeps what is known about a unit on the legacy side, on the same <module>/<unit> path", () => {
    const base = "10-applications/billing/01-legacy/payroll/run-period";
    expect(unitId("billing", "payroll", "run-period")).toBe("billing/payroll/run-period");
    expect(unitLegacyDir("billing", "payroll", "run-period")).toBe(base);
    expect(unitAsIsPath("billing", "payroll", "run-period")).toBe(`${base}/spec.md`);
    expect(unitKeyAsIsPath("billing", "payroll/run-period")).toBe(`${base}/spec.md`);
    expect(unitUnderstandingPath("billing", "payroll", "run-period")).toBe(`${base}/understanding.md`);
    expect(unitRulesPath("billing", "payroll", "run-period")).toBe(`${base}/rules.md`);
    expect(unitRulesDir("billing", "payroll", "run-period")).toBe(`${base}/rules`);
    expect(unitRuleFilePath("billing", "payroll", "run-period", "RULE-payroll.run-period-1a2b3c4d")).toBe(`${base}/rules/RULE-payroll.run-period-1a2b3c4d.md`);
    expect(unitRulesReviewPath("billing", "payroll", "run-period")).toBe(`${base}/rules-review.md`);
    expect(unitFindingsPath("billing", "payroll", "run-period")).toBe(`${base}/findings.md`);
    expect(unitTopologyPath("billing", "payroll", "run-period")).toBe(`${base}/topology.md`);
    expect(unitTracePath("billing", "payroll", "run-period")).toBe(`${base}/trace.md`);
    expect(unitKeyLegacyPath("billing", "payroll/run-period", "trace.md")).toBe(`${base}/trace.md`);
  });

  it("puts the unit's card, design and task pack on the modern side", () => {
    const base = "10-applications/billing/02-modern/payroll/run-period";
    expect(unitModernDir("billing", "payroll", "run-period")).toBe(base);
    expect(unitStatePath("billing", "payroll", "run-period")).toBe(`${base}/README.md`);
    expect(unitTaskPath("billing", "payroll", "run-period")).toBe(`${base}/task.md`);
    expect(unitDesignSetDir("billing", "payroll", "run-period", "detail")).toBe(`${base}/detail`);
    expect(unitDesignFilePath("billing", "payroll", "run-period", "detail", "logic.md")).toBe(`${base}/detail/logic.md`);
    expect(unitKeyDesignSetDir("billing", "payroll/run-period", "basic")).toBe(`${base}/basic`);
    expect(applicationDesignDir("billing")).toBe("10-applications/billing/02-modern/_design");
    expect(applicationDesignSetDir("billing", "arch")).toBe("10-applications/billing/02-modern/_design/arch");
    expect(applicationDesignFilePath("billing", "arch", "overview.md")).toBe("10-applications/billing/02-modern/_design/arch/overview.md");
    expect(transformationNotesPath("billing", "payroll")).toBe("10-applications/billing/02-modern/payroll/TRANSFORMATION_NOTES.md");
    expect(taskPackPath("payroll/run-period")).toBe("10-applications/{app}/02-modern/payroll/run-period/task.md");
  });

  it("puts a project's design sets in 01-standards/templates", () => {
    expect(designSetDir("detail")).toBe("01-standards/templates/detail");
    expect(designSetPath("detail")).toBe("01-standards/templates/detail/set.md");
    expect(designTemplatePath("detail", "logic.md")).toBe("01-standards/templates/detail/logic.md");
  });

  it("puts the common design at project level", () => {
    expect(commonComponentsDir()).toBe("02-architecture/common");
    expect(commonComponentPath("COM-LOG-01")).toBe("02-architecture/common/COM-LOG-01.md");
  });

  it("uses only unit cards, task packs, generated views and the understanding plan as auto-commit defaults", () => {
    expect(DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS).toEqual([
      "10-applications/*/02-modern/*/*/README.md",
      "10-applications/*/02-modern/*/*/task.md",
      "10-applications/*/_generated/**",
      "10-applications/*/01-legacy/plan.md",
    ]);
  });

  it("returns no .json path for a committed document (scratch aside)", () => {
    const app = "billing";
    const committed = [
      layout.assessmentInventoryPath(app),
      layout.assessmentTopologyPath(app),
      layout.assessmentCatalogPath(app),
      layout.assessmentCatalogModulePath(app, "invoicing"),
      layout.understandPlanPath(app),
      layout.unitStatePath(app, "invoicing", "entry"),
      layout.unitUnderstandingPath(app, "invoicing", "entry"),
      layout.unitRulesPath(app, "invoicing", "entry"),
      layout.unitRuleFilePath(app, "invoicing", "entry", "RULE-invoicing.entry-1a2b3c4d"),
      layout.unitRulesReviewPath(app, "invoicing", "entry"),
      layout.unitFindingsPath(app, "invoicing", "entry"),
      layout.unitTopologyPath(app, "invoicing", "entry"),
      layout.unitTracePath(app, "invoicing", "entry"),
    ];
    for (const path of committed) expect(path.endsWith(".json")).toBe(false);
    for (const path of DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS) expect(path.endsWith(".json")).toBe(false);
  });
});
