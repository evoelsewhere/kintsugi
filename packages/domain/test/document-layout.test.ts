import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isBrainIndexedPath } from "../src/brain.js";
import * as layout from "../src/document-layout.js";
import {
  DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS,
  DOCUMENT_EXCLUDED_FOLDERS,
  DOCUMENT_EXCLUDED_ROOTS,
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
  designProfileDir,
  designProfilePath,
  designTemplatePath,
  generatedDir,
  glossaryPath,
  describeDocumentFolder,
  isUnitSegment,
  isWikiEditablePath,
  pageId,
  parsePageId,
  spaceDir,
  spaceHomePath,
  spacesDir,
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
  unitGateReviewPath,
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
  isAttachmentName,
  isAttachmentType,
  isPageId,
  isPageKey,
  isStageWrittenPath,
  pageAttachmentPath,
  pageAttachmentsDir,
  pageFolder,
  pageTemplatesDir,
  spaceTemplatesDir,
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

  it("keeps a review run's data in scratch and its evidence in the unit's _build folder (ADR-0071)", () => {
    expect(layout.buildManifestPath("billing")).toBe("scratch/billing/build/manifest.json");
    expect(layout.buildChangesPath("billing")).toBe("scratch/billing/build/changes.json");
    expect(layout.buildReviewNotePath("billing", "payroll/run-period")).toBe("scratch/billing/build/review/payroll/run-period.md");
    const base = "10-applications/billing/02-modern/payroll/run-period/_build";
    expect(layout.unitKeyBuildDir("billing", "payroll/run-period")).toBe(base);
    expect(layout.unitCodeReviewPath("billing", "payroll/run-period")).toBe(`${base}/review.md`);
    // A design set may not be called `_build`: set ids start with a letter or a digit.
    expect(layout.isUnitSegment("_build")).toBe(false);
  });

  it("puts the unit's card, design and task pack on the modern side", () => {
    const base = "10-applications/billing/02-modern/payroll/run-period";
    expect(unitModernDir("billing", "payroll", "run-period")).toBe(base);
    expect(unitStatePath("billing", "payroll", "run-period")).toBe(`${base}/README.md`);
    expect(unitTaskPath("billing", "payroll", "run-period")).toBe(`${base}/task.md`);
    expect(unitGateReviewPath("billing", "payroll", "run-period")).toBe(base + "/reviews/G4.md");
    expect(unitGateReviewPath("billing", "payroll", "run-period", "stage:understand")).toBe(base + "/reviews/stage%3Aunderstand.md");
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
    expect(designTemplatePath("detail", "screen/logic.md")).toBe("01-standards/templates/detail/screen/logic.md");
    expect(designProfileDir("detail", "screen")).toBe("01-standards/templates/detail/screen");
    expect(designProfilePath("detail", "screen")).toBe("01-standards/templates/detail/screen/profile.md");
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

describe("ADR-0096 wiki layout", () => {
  it("builds team space paths under 20-spaces", () => {
    expect(spacesDir()).toBe("20-spaces");
    expect(spaceDir("onboarding")).toBe("20-spaces/onboarding");
    expect(spaceHomePath("onboarding")).toBe("20-spaces/onboarding/README.md");
    expect(spaceTemplatesDir("onboarding")).toBe("20-spaces/onboarding/_templates");
    expect(pageTemplatesDir()).toBe("01-standards/page-templates");
  });

  it("refuses a space that is not one plain lowercase segment", () => {
    for (const space of ["", "..", ".", "a/b", "Onboarding", "_templates", "-a", "a b", `a${"b".repeat(63)}`]) {
      expect(() => spaceDir(space), space).toThrow();
      expect(() => spaceHomePath(space), space).toThrow();
      expect(() => spaceTemplatesDir(space), space).toThrow();
    }
  });

  it("describes the wiki folders for the Brain", () => {
    expect(describeDocumentFolder("20-spaces")).toMatch(/spaces/i);
    expect(describeDocumentFolder("01-standards/page-templates")).toMatch(/templates/i);
    expect(describeDocumentFolder("20-spaces/handbook")).toMatch(/Space handbook/);
    expect(describeDocumentFolder("20-spaces/handbook/_templates")).toMatch(/templates/i);
    expect(describeDocumentFolder("20-spaces/Handbook")).toBeUndefined();
    expect(describeDocumentFolder("20-spaces/handbook/runbooks")).toBeUndefined();
  });

  it("builds page ids and reads them back", () => {
    expect(pageId("ONB", 1)).toBe("PAGE-ONB-0001");
    expect(pageId("ONB", 12345)).toBe("PAGE-ONB-12345");
    for (const number of [1, 42, 9999, 10000, 999_999_999]) expect(parsePageId(pageId("ONB", number))).toEqual({ key: "ONB", number });
    expect(parsePageId("PAGE-ONB-0007x")).toBeUndefined();
  });

  it("accepts page keys of 2 to 10 uppercase letters and digits, a letter first", () => {
    for (const key of ["ONB", "AB", "A1B2C3D4E5", "X9"]) expect(isPageKey(key), key).toBe(true);
    for (const key of ["A", "A1B2C3D4E5F", "onb", "Onb", "1AB", "ON-B", "ON_B", "", "ONB\n", " ONB"]) expect(isPageKey(key), key).toBe(false);
  });

  it("accepts only PAGE-<KEY>-<nnnn> as a page id", () => {
    for (const id of ["PAGE-ONB-0001", "PAGE-AB-9999", "PAGE-ONB-123456789"]) expect(isPageId(id), id).toBe(true);
    // `pageId` never writes the number 0 or a leading zero beyond four digits, so neither reads back as an id
    const invalid = ["PAGE-ONB-0000", "PAGE-ONB-00001", "PAGE-ONB-099999", "PAGE-ONB-001", "PAGE-ONB-1234567890", "page-onb-0001", "PAGE-onb-0001", "PAGE--0001", "PAGE-O-0001", "PAGE-ABCDEFGHIJK-0001", "PAGE-ONB-0001\n", "PAGE-ONB-0001/../x", "PAGE-ON-B-0001", "RULE-ONB-0001", "ONB-0001", ""];
    for (const id of invalid) {
      expect(isPageId(id), id).toBe(false);
      expect(parsePageId(id), id).toBeUndefined();
    }
  });

  it("refuses to build an id from a bad key or number", () => {
    for (const key of ["", "A", "onb", "ON-B", "ABCDEFGHIJK"]) expect(() => pageId(key, 1), key).toThrow();
    for (const number of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000]) expect(() => pageId("ONB", number), String(number)).toThrow();
  });

  it("puts a page's files in _attachments beside it", () => {
    expect(pageFolder("20-spaces/onboarding/runbooks/deploy.md")).toBe("20-spaces/onboarding/runbooks");
    expect(pageFolder("README.md")).toBe("");
    expect(pageAttachmentsDir("20-spaces/onboarding/runbooks")).toBe("20-spaces/onboarding/runbooks/_attachments");
    expect(pageAttachmentPath("02-architecture", "context.png")).toBe("02-architecture/_attachments/context.png");
    expect(pageAttachmentPath(pageFolder("20-spaces/a/b.md"), "c-1.v2.PDF")).toBe("20-spaces/a/_attachments/c-1.v2.PDF");
  });

  it("refuses an attachment folder or name that could leave the page's folder", () => {
    for (const pageDir of ["", "..", "a/../b", "/a", "a//b", ".hidden/a", "a\\b"]) expect(() => pageAttachmentsDir(pageDir), pageDir).toThrow();
    // a page folder is never an attachment folder, and never under an excluded root or folder, in any letter case
    for (const pageDir of ["a/_attachments", "_attachments", "scratch/x", "Scratch/x", "Plugins/a", "restricted/a", "a/Restricted", "a/identifiers", "a/_generated", "a/_Generated/b"]) {
      expect(() => pageAttachmentsDir(pageDir), pageDir).toThrow();
    }
    expect(pageAttachmentsDir("20-spaces/onb/plugins")).toBe("20-spaces/onb/plugins/_attachments");
    for (const file of ["", ".", "..", ".png", "a/b.png", "../a.png", "a\\b.png", "a b.png", "a\n.png", `${"a".repeat(128)}.png`]) {
      expect(() => pageAttachmentPath("02-architecture", file), file).toThrow();
    }
  });

  it("accepts png, jpg, jpeg, gif, webp and pdf attachments in any letter case, and no other type", () => {
    for (const file of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.pdf", "Photo_1.JPG", "spec.v2.PdF"]) expect(isAttachmentType(file), file).toBe(true);
    for (const file of ["a.svg", "a.html", "a.md", "a.exe", "a.png.exe", "png", ".png", "a.", ""]) expect(isAttachmentType(file), file).toBe(false);
    expect(isAttachmentName("Photo_1.JPG")).toBe(true);
    expect(isAttachmentName("a b.png")).toBe(false);
  });

  it("tells the documents a stage writes", () => {
    for (const path of ["10-applications/billing/01-legacy/plan.md", "10-applications/billing/02-modern/invoicing/entry/README.md", "10-applications/billing/_generated/GAPS.md"]) {
      expect(isStageWrittenPath(path), path).toBe(true);
    }
    for (const path of ["10-applications/billing/00-inputs/intent.md", "10-applications/billing/README.md", "20-spaces/onboarding/README.md", "10-applications/Billing/01-legacy/plan.md", "10-applications/billing/01-legacy"]) {
      expect(isStageWrittenPath(path), path).toBe(false);
    }
  });

  it("lets the wiki edit pages and attachments of ordinary folders", () => {
    const editable = [
      "20-spaces/onb/onboarding.md",
      "20-spaces/onb/README.md",
      "20-spaces/onb/runbooks/deploy.md",
      "20-spaces/onb/_attachments/a.png",
      "20-spaces/onb/_templates/meeting.md",
      "00-project/README.md",
      "00-project/charter.md",
      "01-standards/conventions/naming.md",
      "01-standards/page-templates/meeting.md",
      "02-architecture/_attachments/context.PDF",
      "10-applications/billing/00-inputs/intent.md",
      "20-spaces/onb/README.MD",
    ];
    for (const path of editable) expect(isWikiEditablePath(path), path).toBe(true);
  });

  it("never lets the wiki edit generated, restricted, plugin, scratch, hidden, ledger, stage-written or non-page files", () => {
    const refused = [
      "kintsugi.yaml",
      "00-project/kintsugi.yaml",
      "10-applications/billing/_generated/GAPS.md",
      "02-architecture/_generated/x.md",
      "20-spaces/onb/_generated/x.md",
      "restricted/secret.md",
      "20-spaces/onb/Restricted/secret.md",
      "plugins/my-plugin/README.md",
      "Plugins/x.md",
      "SCRATCH/a/x.md",
      "scratch/billing/note.md",
      "20-spaces/onb/identifiers/x.md",
      "10-applications/billing/01-legacy/invoicing/entry/identifiers/rules-ids.md",
      "10-applications/billing/01-legacy/plan.md",
      "10-applications/billing/02-modern/requirements.md",
      ".github/workflows/readme.md",
      "20-spaces/.hidden/a.md",
      "20-spaces/onb/.draft.md",
      "20-spaces/onb/_attachments/.a.png",
      // not a page, and not an attachment of an allowed type in an _attachments folder
      "20-spaces/onb/notes.txt",
      "20-spaces/onb/a.png",
      "20-spaces/onb/_attachments/a.svg",
      "20-spaces/onb/_attachments/a.md.exe",
      "20-spaces/onb/_attachments/sub/a.png",
      "01-standards/conventions/naming.json",
      // paths that are not plain
      "20-spaces/../00-project/charter.md",
      "../outside.md",
      "/abs/path.md",
      "20-spaces//a.md",
      "20-spaces\\onb\\a.md",
      "20-spaces/onb/",
      "",
    ];
    for (const path of refused) expect(isWikiEditablePath(path), path).toBe(false);
  });

  it("shares its excluded folders with the Brain index", () => {
    expect(DOCUMENT_EXCLUDED_ROOTS).toEqual(["plugins", "scratch"]);
    expect(DOCUMENT_EXCLUDED_FOLDERS).toEqual(["restricted", "identifiers"]);
    for (const path of ["plugins/a.md", "scratch/billing/a.md", "restricted/a.md", "20-spaces/onb/Restricted/a.md", "x/identifiers/a.md", ".hidden/a.md", "a/.hidden/b.md"]) {
      expect(isBrainIndexedPath(path), path).toBe(false);
      expect(isWikiEditablePath(path), path).toBe(false);
    }
    // Whatever the wiki may edit as a page, the Brain indexes.
    for (const path of ["20-spaces/onb/a.md", "00-project/charter.md", "01-standards/conventions/naming.md"]) expect(isBrainIndexedPath(path), path).toBe(true);
  });
});

describe("the wiki layout shared with the plugins' paths.py", () => {
  interface WikiCase {
    fn: string;
    args: Array<string | number>;
    expect: string | boolean | null | Array<string | number> | { throws: true };
  }
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/wiki-layout.json", import.meta.url), "utf8")) as { cases: WikiCase[] };
  const functions = layout as unknown as Record<string, (...args: Array<string | number>) => unknown>;

  it("answers every case of the fixture that scripts/tests/test_wiki_paths.py holds both paths.py to", () => {
    expect(fixture.cases.length).toBeGreaterThan(150);
    for (const { fn, args, expect: expected } of fixture.cases) {
      const call = functions[fn];
      expect(call, fn).toBeTypeOf("function");
      const label = `${fn}(${JSON.stringify(args)})`;
      if (typeof expected === "object" && expected !== null && !Array.isArray(expected)) {
        expect(() => call?.(...args), label).toThrow();
        continue;
      }
      let actual = call?.(...args);
      // parsePageId gives an object here and a tuple in Python; the fixture holds [key, number] or null.
      if (fn === "parsePageId") actual = actual === undefined ? null : [(actual as { key: string }).key, (actual as { number: number }).number];
      expect(actual, label).toEqual(expected);
    }
  });
});
