// Application layer: the design of a project, read from its document repo (ADR-0044, ADR-0045): the
// design sets the project defined under `01-standards/templates/`, and for each unit how its design
// documents stand against them. The conformance is the reader's (the checks the member's
// `check_design.py` mirrors); what is derived here is never stored, so a design is stale or not
// by comparing the version it names with the set's, on every read.
//
// A scan of an application reads many small documents. A commit never changes, so a scan is kept
// by commit and application, and a few are remembered.

import { Injectable, NotFoundException } from "@nestjs/common";
import {
  type DesignContext,
  type DesignProblem,
  type DesignProfileSource,
  type DesignSection,
  type DesignSet,
  type LoadedDesignSet,
  type DesignSetSource,
  type ResolvedDesignFile,
  checkDesignDocument,
  designInputBlockers,
  type ItemCatalogItem,
  designBaseFiles,
  designCoverage,
  designFilesFor,
  designIsStale,
  designItemIds,
  designReferences,
  designRefText,
  designTemplateOf,
  designTemplateRefOf,
  documentOf,
  loadDesignSets,
  parseWorkItem,
  ruleCardsOf,
  textOf,
} from "@kintsugi/agents/reader";
import {
  COMPONENT_ID_PATTERN,
  DEFAULT_UNIT_KINDS,
  DESIGN_EXAMPLES_DIR,
  DESIGN_PROFILE_FILE,
  type DesignState,
  applicationDesignFilePath,
  applicationRequirementsPath,
  commonComponentPath,
  commonComponentsDir,
  designProfileDir,
  designProfilePath,
  designSetDir,
  designSetPath,
  designSetsDir,
  isUnitSegment,
  modernDir,
  modernModuleDir,
  parseDesignWaiver,
  parseRequirementsMarkdown,
  unitDesignFilePath,
  unitRulesPath,
  unitAsIsPath,
  unitUnderstandingPath,
  unitRulesReviewPath,
  unitStatePath,
} from "@kintsugi/domain";
import { parseKintsugiYaml } from "@kintsugi/manifest";
import { chunk } from "#common/util/async.js";
import { CatalogService } from "#modules/delivery/catalog/index.js";
import { type DocumentContext, DocumentsService } from "#modules/delivery/documents/index.js";
import type {
  CommonComponentView,
  CommonDesignView,
  DesignAttention,
  DesignFileView,
  DesignOverviewView,
  DesignProfileView,
  DesignSectionView,
  DesignSetFileView,
  DesignSetView,
  DesignSetsView,
  DesignTemplateProblemView,
  UnitCoverageRow,
  UnitDesignRow,
  UnitDesignView,
  UnitSetDetail,
  UnitSetSummary,
  UnresolvedReference,
} from "../domain/design.js";

const MAX_TEMPLATE_BYTES = 256 * 1024;
const MAX_DESIGN_BYTES = 1024 * 1024;
const MAX_RULES_BYTES = 2 * 1024 * 1024;
const MAX_UNITS = 2000;
/** Reads at once. */
const READS = 8;
/** Scans and set lists kept. */
const KEPT = 8;
const COMPONENT_MENTION = /\bCOM-[A-Z0-9][A-Z0-9-]{0,38}\b/g;

interface ResolvedRef {
  ref: string;
  commit: string;
}

interface Opened {
  context: DocumentContext;
  resolved: ResolvedRef;
}

/** The sets of a project at a commit, in the order they are written, and what the manifest says about them. */
interface ProjectSets {
  sets: LoadedDesignSet[];
  /** The unit kinds kintsugi.yaml declares, else the default the portal renders (DEFAULT_UNIT_KINDS). */
  unitKinds: string[];
  problems: DesignTemplateProblemView[];
  pipelines: Array<{ id: string; stages: Array<{ id: string; produces?: string }> }>;
}

/** One unit with everything the views need, computed once per scan. */
interface UnitScan {
  row: UnitDesignRow;
  details: UnitSetDetail[];
  coverage: UnitCoverageRow[];
  unresolved: UnresolvedReference[];
  componentRefs: Set<string>;
  anyStale: boolean;
}

/** The application's own design (sets of scope `application`), computed once per scan. */
interface ApplicationScan {
  summaries: Record<string, UnitSetSummary>;
  details: UnitSetDetail[];
  unresolved: UnresolvedReference[];
  componentRefs: Set<string>;
  anyStale: boolean;
  /** The design items of each of its sets: what a unit's design that needs one can point to. */
  items: Record<string, string[]>;
}

interface AppScan {
  project: ProjectSets;
  application: ApplicationScan;
  units: UnitScan[];
  components: Array<{ id: string; path: string }>;
}

/** A check as written in the template. */
function checkText(check: DesignSection["checks"][number]): string {
  switch (check.name) {
    case "no-placeholder":
      return check.name;
    case "covers-rules":
      return `${check.name}(${check.column})`;
    case "refs-resolve":
      return `${check.name}(${check.column} -> ${check.source})`;
    case "id-pattern":
      return `${check.name}(${check.column}, ${check.pattern})`;
    case "max-length":
      return `${check.name}(${check.limit})`;
    case "one-of":
      return `${check.name}(${check.column}, ${check.options.join("|")})`;
  }
}

function sectionView(section: DesignSection): DesignSectionView {
  return {
    heading: section.heading,
    level: section.level,
    required: section.required,
    ...(section.table === undefined ? {} : { table: section.table }),
    ...(section.seed === undefined ? {} : { seed: section.seed }),
    checks: section.checks.map(checkText),
    ...(section.guidance === undefined ? {} : { guidance: section.guidance }),
  };
}

/** The sets so that each comes after the ones it needs; a cycle (reported elsewhere) falls back to the order of their ids. */
function writtenOrder(sets: LoadedDesignSet[]): LoadedDesignSet[] {
  const byId = new Map(sets.map((loaded) => [loaded.set.id, loaded]));
  const placed: LoadedDesignSet[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (loaded: LoadedDesignSet): void => {
    if (state.has(loaded.set.id)) return;
    state.set(loaded.set.id, "visiting");
    for (const need of [...loaded.set.needs].sort()) {
      const target = byId.get(need);
      if (target !== undefined && state.get(need) !== "visiting") visit(target);
    }
    state.set(loaded.set.id, "done");
    placed.push(loaded);
  };
  for (const loaded of [...sets].sort((a, b) => a.set.id.localeCompare(b.set.id))) visit(loaded);
  return placed;
}

/** The state one set is in for one unit, from its files. */
function setState(files: DesignFileView[]): { state: DesignState; counts: UnitSetSummary["files"] } {
  // A file nobody has to write and nobody wrote is not counted.
  const counted = files.filter((file) => file.required || file.state !== "missing");
  const counts = {
    total: counted.length,
    conformant: counted.filter((file) => file.state === "conformant").length,
    problems: counted.filter((file) => file.state === "problems").length,
    missing: counted.filter((file) => file.state === "missing").length,
    stale: counted.filter((file) => file.stale).length,
    waived: counted.filter((file) => file.state === "waived").length,
  };
  if (counts.problems > 0) return { state: "problems", counts };
  if (counts.missing > 0) return { state: "missing", counts };
  if (counts.stale > 0) return { state: "stale", counts };
  if (counts.total > 0 && counts.waived === counts.total) return { state: "waived", counts };
  return { state: "conformant", counts };
}

const finished = (state: DesignState): boolean => state === "conformant" || state === "stale" || state === "waived";

@Injectable()
export class DesignService {
  private readonly projectSets = new Map<string, Promise<ProjectSets>>();
  private readonly scans = new Map<string, Promise<AppScan>>();

  constructor(private readonly documents: DocumentsService, private readonly catalog: CatalogService) {}

  /** The design sets of the project at a ref, with the faults of their definitions; with an application, how its units stand with each. */
  async sets(projectId: string, ref: string | undefined, applicationId: string | undefined): Promise<DesignSetsView> {
    const { context, resolved } = await this.open(projectId, ref);
    const project = await this.loadProject(context, resolved.commit);
    const scan = applicationId === undefined ? undefined : await this.scan(context, resolved.commit, this.application(context, applicationId));
    const sets = project.sets.map((loaded): DesignSetView => {
      const { set } = loaded;
      const usage = scan === undefined ? undefined : this.usage(scan, set);
      const fileView = (loadedSet: LoadedDesignSet, file: ResolvedDesignFile): DesignSetFileView => ({
        path: file.path,
        template: file.template,
        required: file.required,
        ...(file.profile === null ? {} : { profile: file.profile }),
        ref: designRefText(file.ref),
        ...(file.example === null ? {} : { example: file.example }),
        sections: (designTemplateOf(loadedSet, file)?.sections ?? []).map(sectionView),
      });
      const profiles = Object.keys(loaded.profiles)
        .sort()
        .map((kind): DesignProfileView => {
          const entry = loaded.profiles[kind] as NonNullable<(typeof loaded.profiles)[string]>;
          return {
            kind,
            version: entry.profile.version,
            removes: entry.profile.removes,
            instructions: entry.profile.instructions,
            files: designFilesFor(loaded, kind).map((file) => fileView(loaded, file)),
            examples: entry.examples,
          };
        });
      return {
        id: set.id,
        title: set.title,
        version: set.version,
        scope: set.scope,
        // Every kind when the set has files of its own; else the kinds whose profile leaves it a file.
        appliesTo: set.scope === "application" || set.files.length > 0 ? [] : profiles.filter((profile) => profile.files.length > 0).map((profile) => profile.kind),
        needs: set.needs,
        ...(set.stage === undefined ? {} : { stage: set.stage }),
        description: set.description,
        reads: set.reads,
        instructions: set.instructions,
        producedBy: project.pipelines.flatMap((pipeline) => pipeline.stages.filter((stage) => stage.produces === set.id).map((stage) => ({ pipeline: pipeline.id, stage: stage.id }))),
        files: designBaseFiles(loaded).map((file) => fileView(loaded, file)),
        profiles,
        ...(usage === undefined ? {} : { usage }),
      };
    });
    return { ref: resolved, sets, problems: project.problems };
  }

  /** Every unit of the application with where its design stands, per set. */
  async overview(projectId: string, applicationId: string, ref: string | undefined): Promise<DesignOverviewView> {
    const { context, resolved } = await this.open(projectId, ref);
    this.application(context, applicationId);
    const scan = await this.scan(context, resolved.commit, applicationId);
    const counts: DesignOverviewView["counts"] = {};
    for (const { set } of scan.project.sets) counts[set.id] = {};
    for (const [setId, summary] of Object.entries(scan.application.summaries)) counts[setId] = { [summary.state]: 1 };
    let ruleUnits = 0;
    let ruleTotal = 0;
    let ruleUncovered = 0;
    for (const unit of scan.units) {
      for (const [setId, summary] of Object.entries(unit.row.sets)) {
        const bucket = (counts[setId] ??= {});
        bucket[summary.state] = (bucket[summary.state] ?? 0) + 1;
      }
      if (unit.row.rules.uncovered !== null) {
        ruleUnits += 1;
        ruleTotal += unit.row.rules.total;
        ruleUncovered += unit.row.rules.uncovered;
      }
    }
    const componentIds = new Set(scan.components.map((component) => component.id));
    const unresolvedComponents = new Set([...scan.units.flatMap((unit) => [...unit.componentRefs]), ...scan.application.componentRefs].filter((id) => !componentIds.has(id)));
    const attention: DesignAttention[] = [];
    if (scan.project.problems.length > 0) attention.push({ kind: "template-error", count: scan.project.problems.length, label: `${scan.project.problems.length} problem(s) in the design templates` });
    if (unresolvedComponents.size > 0) attention.push({ kind: "unresolved-component", count: unresolvedComponents.size, label: `${unresolvedComponents.size} common component(s) named by a design and not defined` });
    const uncovered = scan.units.filter((unit) => (unit.row.rules.uncovered ?? 0) > 0).length;
    if (uncovered > 0) attention.push({ kind: "uncovered-rules", count: uncovered, label: `${uncovered} unit(s) with rules no design covers` });
    const stale = scan.units.filter((unit) => unit.anyStale).length + (scan.application.anyStale ? 1 : 0);
    if (stale > 0) attention.push({ kind: "stale", count: stale, label: `${stale} unit(s) with a design written against an older version of its set` });
    return {
      ref: resolved,
      sets: scan.project.sets.map(({ set }) => ({ id: set.id, title: set.title, version: set.version, needs: set.needs, scope: set.scope })),
      unitKinds: scan.project.unitKinds,
      application: { sets: scan.application.summaries },
      units: scan.units.map((unit) => unit.row),
      counts,
      rules: { units: ruleUnits, total: ruleTotal, uncovered: ruleUncovered },
      attention,
      templateProblems: scan.project.problems.length,
    };
  }

  /** One unit's design documents with their problems, the rules each design covers, and the references that do not resolve. */
  async unit(projectId: string, applicationId: string, module: string, unit: string, ref: string | undefined): Promise<UnitDesignView> {
    const { context, resolved } = await this.open(projectId, ref);
    this.application(context, applicationId);
    const scan = await this.scan(context, resolved.commit, applicationId);
    const found = scan.units.find((candidate) => candidate.row.module === module && candidate.row.unit === unit);
    if (found === undefined) throw new NotFoundException(`Unit ${applicationId}/${module}/${unit} has no ${unitStatePath(applicationId, module, unit)} at ${resolved.ref}`);
    const { row } = found;
    return {
      ref: resolved,
      unit: { key: row.key, module, unit, kind: row.kind, ...(row.title === undefined ? {} : { title: row.title }) },
      sets: found.details,
      coverage: found.coverage,
      unresolved: found.unresolved,
    };
  }

  /** The application's own design: its sets of scope `application`, each file with its state and problems (ADR-0050). */
  async applicationDesign(projectId: string, applicationId: string, ref: string | undefined): Promise<UnitDesignView> {
    const { context, resolved } = await this.open(projectId, ref);
    const application = context.project.applications.find((entry) => entry.id === this.application(context, applicationId));
    const scan = await this.scan(context, resolved.commit, applicationId);
    return {
      ref: resolved,
      unit: { key: "@app", module: "@app", unit: "@app", kind: "application", ...(application?.name === undefined ? {} : { title: application.name }) },
      sets: scan.application.details,
      coverage: [],
      unresolved: scan.application.unresolved,
    };
  }

  /** The common components of the project and the units that name each one. */
  async common(projectId: string, applicationId: string, ref: string | undefined): Promise<CommonDesignView> {
    const { context, resolved } = await this.open(projectId, ref);
    this.application(context, applicationId);
    const scan = await this.scan(context, resolved.commit, applicationId);
    const named = new Map<string, string[]>();
    for (const unit of scan.units) for (const id of unit.componentRefs) named.set(id, [...(named.get(id) ?? []), unit.row.key]);
    for (const id of scan.application.componentRefs) named.set(id, [...(named.get(id) ?? []), "@app"]);
    const components: CommonComponentView[] = [];
    for (const group of chunk(scan.components, READS)) {
      components.push(
        ...(await Promise.all(
          group.map(async (component): Promise<CommonComponentView> => {
            const text = await this.documents.readText(context, resolved.commit, component.path, MAX_DESIGN_BYTES);
            const data = text === undefined ? {} : documentOf(text).data;
            const title = textOf(data["title"], 160);
            const status = textOf(data["status"], 40);
            return { id: component.id, ...(title === undefined ? {} : { title }), ...(status === undefined ? {} : { status }), path: component.path, referencedBy: named.get(component.id) ?? [] };
          }),
        )),
      );
    }
    const defined = new Set(scan.components.map((component) => component.id));
    return {
      ref: resolved,
      components,
      unresolved: [...named.entries()].filter(([id]) => !defined.has(id)).map(([id, referencedBy]) => ({ id, referencedBy })).sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  // ---------------------------------------------------------------------------

  private async open(projectId: string, ref: string | undefined): Promise<Opened> {
    const context = await this.documents.context(projectId);
    return { context, resolved: await this.documents.resolve(context, ref) };
  }

  private application(context: DocumentContext, applicationId: string): string {
    if (!context.project.applications.some((application) => application.id === applicationId)) {
      throw new NotFoundException(`Application ${applicationId} not found in project ${context.project.id}`);
    }
    return applicationId;
  }

  private usage(scan: AppScan, set: DesignSet): { units: number; onCurrent: number; stale: number } {
    if (set.scope === "application") {
      const summary = scan.application.summaries[set.id];
      const written = summary !== undefined && summary.files.conformant + summary.files.problems > 0;
      return { units: written ? 1 : 0, onCurrent: written && summary.files.stale === 0 ? 1 : 0, stale: written && summary.files.stale > 0 ? 1 : 0 };
    }
    const summaries = scan.units.flatMap((unit) => (unit.row.sets[set.id] === undefined ? [] : [{ unit, summary: unit.row.sets[set.id] as UnitSetSummary }]));
    // A unit is on the current version when it has a design of the set and none of its files is stale.
    const written = summaries.filter(({ summary }) => summary.files.conformant + summary.files.problems > 0);
    const stale = written.filter(({ summary }) => summary.files.stale > 0).length;
    return { units: written.length, onCurrent: written.length - stale, stale };
  }

  private remember<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const known = cache.get(key);
    if (known !== undefined) return known;
    const created = load();
    cache.set(key, created);
    created.catch(() => cache.delete(key));
    while (cache.size > KEPT) cache.delete(cache.keys().next().value as string);
    return created;
  }

  private loadProject(context: DocumentContext, commit: string): Promise<ProjectSets> {
    return this.remember(this.projectSets, `${context.project.id}|${commit}`, async () => {
      const root = designSetsDir();
      const folders = (await this.documents.listNames(context, commit, root)).filter((entry) => entry.kind === "dir").map((entry) => entry.name);
      const sources: DesignSetSource[] = [];
      for (const group of chunk(folders, READS)) {
        sources.push(
          ...(await Promise.all(
            group.map(async (folder): Promise<DesignSetSource> => {
              const dir = designSetDir(folder);
              const entries = await this.documents.listNames(context, commit, dir);
              const markdown = (names: Array<{ kind: string; name: string }>): string[] => names.filter((entry) => entry.kind === "file" && entry.name.endsWith(".md")).map((entry) => entry.name);
              const read = async (path: string): Promise<string | undefined> => this.documents.readText(context, commit, path, MAX_TEMPLATE_BYTES);
              const readAll = async (path: string, names: string[]): Promise<Record<string, string>> => {
                const found = await Promise.all(names.map(async (name) => [name, await read(`${path}/${name}`)] as const));
                return Object.fromEntries(found.filter((entry): entry is [string, string] => entry[1] !== undefined));
              };
              const examples = async (path: string): Promise<string[]> => markdown(await this.documents.listNames(context, commit, `${path}/${DESIGN_EXAMPLES_DIR}`));
              const files = markdown(entries);
              // A folder that does not start with `_` is the profile of the unit kind it is named after (ADR-0053).
              const profiles: Record<string, DesignProfileSource> = {};
              for (const kind of entries.filter((entry) => entry.kind === "dir" && !entry.name.startsWith("_")).map((entry) => entry.name)) {
                const profileDir = designProfileDir(folder, kind);
                const inside = markdown(await this.documents.listNames(context, commit, profileDir));
                profiles[kind] = {
                  profileText: inside.includes(DESIGN_PROFILE_FILE) ? await read(designProfilePath(folder, kind)) : undefined,
                  templates: await readAll(profileDir, inside.filter((name) => name !== DESIGN_PROFILE_FILE)),
                  examples: await examples(profileDir),
                };
              }
              return {
                folder,
                setText: files.includes("set.md") ? await read(designSetPath(folder)) : undefined,
                templates: await readAll(dir, files.filter((name) => name !== "set.md")),
                examples: await examples(dir),
                profiles,
              };
            }),
          )),
        );
      }
      const manifestText = await this.documents.readText(context, commit, "kintsugi.yaml", MAX_TEMPLATE_BYTES);
      const parsed = manifestText === undefined ? undefined : parseKintsugiYaml(manifestText);
      const manifest = parsed?.ok === true ? parsed.manifest : undefined;
      const unitKinds = manifest !== undefined && manifest.unitKinds.length > 0 ? manifest.unitKinds : undefined;
      const loaded = loadDesignSets(sources, unitKinds === undefined ? {} : { unitKinds });
      const problems: DesignTemplateProblemView[] = [...loaded.problems];
      const pipelines = (manifest?.pipelines ?? []).map((pipeline) => ({
        id: pipeline.id,
        stages: pipeline.phases.flatMap((phase) => phase.stages.map((stage) => ({ id: stage.id, ...(stage.produces === undefined ? {} : { produces: stage.produces }) }))),
      }));
      const known = new Set(loaded.sets.map((entry) => entry.set.id));
      for (const pipeline of pipelines) {
        for (const stage of pipeline.stages) {
          if (stage.produces !== undefined && !known.has(stage.produces)) problems.push({ path: "kintsugi.yaml", message: `pipeline "${pipeline.id}", stage "${stage.id}" produces "${stage.produces}", which is not a design set` });
        }
      }
      return { sets: writtenOrder(loaded.sets), unitKinds: unitKinds === undefined ? [...DEFAULT_UNIT_KINDS] : [...unitKinds], problems, pipelines };
    });
  }

  private scan(context: DocumentContext, commit: string, applicationId: string): Promise<AppScan> {
    return this.remember(this.scans, `${context.project.id}|${commit}|${applicationId}`, async () => {
      const project = await this.loadProject(context, commit);
      const [componentNames, requirementsText, modules] = await Promise.all([
        this.documents.listNames(context, commit, commonComponentsDir()),
        this.documents.readText(context, commit, applicationRequirementsPath(applicationId), MAX_RULES_BYTES),
        this.documents.listNames(context, commit, modernDir(applicationId)),
      ]);
      const components = componentNames
        .filter((entry) => entry.kind === "file" && entry.name.endsWith(".md") && COMPONENT_ID_PATTERN.test(entry.name.slice(0, -3)))
        .map((entry) => ({ id: entry.name.slice(0, -3), path: commonComponentPath(entry.name.slice(0, -3)) }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const requirementIds = requirementsText === undefined ? [] : parseRequirementsMarkdown(requirementsText).map((requirement) => requirement.id);
      const keys: Array<{ module: string; unit: string }> = [];
      // The units are the folders on the modern side; `_design/` and the other `_` folders belong to the application.
      const unitFolders = (entries: Array<{ kind: string; name: string }>): string[] => entries.filter((entry) => entry.kind === "dir" && isUnitSegment(entry.name)).map((entry) => entry.name).sort();
      for (const module of unitFolders(modules)) {
        for (const unit of unitFolders(await this.documents.listNames(context, commit, modernModuleDir(applicationId, module)))) {
          if (keys.length < MAX_UNITS) keys.push({ module, unit });
        }
      }
      const catalog = await this.catalog.load(context.project.id, applicationId, commit).catch((error: unknown) => {
        if (error instanceof NotFoundException) return undefined;
        throw error;
      });
      const active = new Map((catalog?.catalog.items ?? []).filter((item) => item.status === "active").map((item) => [item.id, item]));
      const knownKeys = new Set(keys.map((key) => `${key.module}/${key.unit}`));
      for (const item of active.values()) {
        if (!knownKeys.has(item.id) && keys.length < MAX_UNITS) {
          const [module, unit] = item.id.split("/") as [string, string];
          keys.push({ module, unit });
        }
      }
      const shared: Omit<DesignContext, "items"> = { ruleIds: [], requirementIds, componentIds: components.map((component) => component.id) };
      // The application's own design first: a unit's design may point to the items of the sets of the application it needs.
      const application = await this.scanApplication(context, commit, applicationId, project, shared);
      const units: UnitScan[] = [];
      for (const group of chunk(keys, READS)) {
        const scanned = await Promise.all(group.map((key) => this.scanUnit(context, commit, applicationId, key.module, key.unit, project, shared, application, active.get(`${key.module}/${key.unit}`))));
        units.push(...scanned.filter((unit): unit is UnitScan => unit !== undefined));
      }
      return { project, application, units, components };
    });
  }

  /** The application's own design: the files of each set of scope `application` against its template, with the ids it points to. */
  private async scanApplication(context: DocumentContext, commit: string, app: string, project: ProjectSets, shared: Omit<DesignContext, "items">): Promise<ApplicationScan> {
    const applicable = project.sets.filter((loaded) => designFilesFor(loaded, null).length > 0);
    const texts = new Map<string, string | undefined>();
    await Promise.all(
      applicable.flatMap((loaded) =>
        designFilesFor(loaded, null).map(async (file) => {
          texts.set(`${loaded.set.id}/${file.path}`, await this.documents.readText(context, commit, applicationDesignFilePath(app, loaded.set.id, file.path), MAX_DESIGN_BYTES));
        }),
      ),
    );
    const items: Record<string, string[]> = {};
    for (const loaded of applicable) {
      items[loaded.set.id] = [...new Set(designFilesFor(loaded, null).flatMap((file) => designItemIds(texts.get(`${loaded.set.id}/${file.path}`) ?? "")))];
    }
    const designContext: DesignContext = { ...shared, ruleIds: [], items };
    const details: UnitSetDetail[] = [];
    const summaries: Record<string, UnitSetSummary> = {};
    const unresolved: UnresolvedReference[] = [];
    const componentRefs = new Set<string>();
    let anyStale = false;

    for (const loaded of applicable) {
      const { set } = loaded;
      const files: DesignFileView[] = designFilesFor(loaded, null).map((file) => {
        const text = texts.get(`${set.id}/${file.path}`);
        const template = designTemplateOf(loaded, file);
        const base = { path: file.path, required: file.required, expected: designRefText(file.ref), stale: false, problems: [] as DesignProblem[] };
        if (text === undefined || template === undefined) return { ...base, state: "missing" as const };
        const problems = checkDesignDocument(template, file.ref, text, designContext);
        const ref = designTemplateRefOf(text);
        for (const mention of text.match(COMPONENT_MENTION) ?? []) componentRefs.add(mention);
        for (const reference of designReferences(template, text, designContext)) {
          for (const id of reference.unresolved) unresolved.push({ id, source: reference.source, set: set.id, file: file.path, section: reference.section });
        }
        return { ...base, state: problems.length > 0 ? ("problems" as const) : ("conformant" as const), stale: designIsStale(text, file.ref), ...(ref === null ? {} : { template: ref }), problems };
      });
      if (files.some((file) => file.stale)) anyStale = true;
      const { state, counts } = setState(files);
      details.push({ set: set.id, title: set.title, version: set.version, state, needs: set.needs, files });
      summaries[set.id] = { set: set.id, version: set.version, state, files: counts, ready: false };
    }
    for (const detail of details) {
      const summary = summaries[detail.set] as UnitSetSummary;
      summary.blockers = detail.needs.filter((need) => summaries[need] === undefined || !finished(summaries[need]!.state)).map((need) => `Needs the merged, conformant ${need} design first.`);
      summary.ready = summary.blockers.length === 0 && summary.state === "missing" && summary.files.conformant + summary.files.problems === 0;
    }
    return { summaries, details, unresolved, componentRefs, anyStale, items };
  }

  /** One unit: its state file, its rules, its design documents, and what the checks say. Undefined without a unit file. */
  private async scanUnit(context: DocumentContext, commit: string, app: string, module: string, unit: string, project: ProjectSets, shared: Omit<DesignContext, "items">, application: ApplicationScan, catalogItem?: ItemCatalogItem): Promise<UnitScan | undefined> {
    const stateText = await this.documents.readText(context, commit, unitStatePath(app, module, unit), MAX_DESIGN_BYTES);
    const summary = stateText === undefined ? (catalogItem === undefined ? null : { kind: catalogItem.kind, title: catalogItem.name, assignee: undefined }) : parseWorkItem(stateText);
    if (summary === null || summary.kind === undefined) return undefined;
    const data = documentOf(stateText ?? "").data;
    const waived = new Map<string, string>();
    for (const entry of Array.isArray(data["waived"]) ? data["waived"] : []) {
      const waiver = typeof entry === "string" ? parseDesignWaiver(entry) : undefined;
      if (waiver !== undefined) waived.set(`${waiver.set}/${waiver.file}`, waiver.reason);
    }
    const rulesText = await this.documents.readText(context, commit, unitRulesPath(app, module, unit), MAX_RULES_BYTES);
    const rules = rulesText === undefined ? [] : ruleCardsOf(rulesText);
    const [specification, understanding, review] = await Promise.all([
      this.documents.readText(context, commit, unitAsIsPath(app, module, unit), MAX_DESIGN_BYTES),
      this.documents.readText(context, commit, unitUnderstandingPath(app, module, unit), MAX_DESIGN_BYTES),
      this.documents.readText(context, commit, unitRulesReviewPath(app, module, unit), MAX_RULES_BYTES),
    ]);
    const evidenceBlockers = designInputBlockers({ specification, understanding, rules: rulesText, review, catalogDigest: catalogItem?.digest });
    const kind = summary.kind;
    const applicable = project.sets.filter((loaded) => designFilesFor(loaded, kind).length > 0);

    // Read every document of every applicable set first: a design points to the design items of the sets it needs.
    const texts = new Map<string, string | undefined>();
    await Promise.all(
      applicable.flatMap((loaded) =>
        designFilesFor(loaded, kind).map(async (file) => {
          texts.set(`${loaded.set.id}/${file.path}`, await this.documents.readText(context, commit, unitDesignFilePath(app, module, unit, loaded.set.id, file.path), MAX_DESIGN_BYTES));
        }),
      ),
    );
    // The items of the application's own sets resolve too: a unit's design may need one.
    const items: Record<string, string[]> = { ...application.items };
    for (const loaded of applicable) {
      items[loaded.set.id] = [...new Set(designFilesFor(loaded, kind).flatMap((file) => designItemIds(texts.get(`${loaded.set.id}/${file.path}`) ?? "")))];
    }
    const context2: DesignContext = { ...shared, ruleIds: rules.map((rule) => rule.id), items };

    const details: UnitSetDetail[] = [];
    const sets: Record<string, UnitSetSummary> = {};
    const coveredBy = new Map<string, Array<{ set: string; file: string; section: string }>>();
    const unresolved: UnresolvedReference[] = [];
    const componentRefs = new Set<string>();
    const uncoveredIds = new Set<string>();
    let coversRules = false;
    let anyStale = false;

    for (const loaded of applicable) {
      const { set } = loaded;
      const files: DesignFileView[] = designFilesFor(loaded, kind).map((file) => {
        const key = `${set.id}/${file.path}`;
        const text = texts.get(key);
        const waiver = waived.get(key);
        const template = designTemplateOf(loaded, file);
        const base = { path: file.path, required: file.required, expected: designRefText(file.ref), stale: false, problems: [] as DesignProblem[] };
        if (waiver !== undefined) return { ...base, state: "waived" as const, waiver };
        if (text === undefined || template === undefined) return { ...base, state: "missing" as const };
        const problems = checkDesignDocument(template, file.ref, text, context2);
        const stale = designIsStale(text, file.ref);
        const ref = designTemplateRefOf(text);
        for (const mention of text.match(COMPONENT_MENTION) ?? []) componentRefs.add(mention);
        for (const section of designCoverage(template, text, context2.ruleIds)) {
          coversRules = true;
          for (const id of context2.ruleIds) {
            if (section.covered.includes(id)) coveredBy.set(id, [...(coveredBy.get(id) ?? []), { set: set.id, file: file.path, section: section.section }]);
            else uncoveredIds.add(id);
          }
        }
        for (const reference of designReferences(template, text, context2)) {
          for (const id of reference.unresolved) unresolved.push({ id, source: reference.source, set: set.id, file: file.path, section: reference.section });
        }
        return { ...base, state: problems.length > 0 ? ("problems" as const) : ("conformant" as const), stale, ...(ref === null ? {} : { template: ref }), problems };
      });
      if (files.some((file) => file.stale)) anyStale = true;
      const { state, counts } = setState(files);
      details.push({ set: set.id, title: set.title, version: set.version, state, needs: set.needs, files });
      sets[set.id] = { set: set.id, version: set.version, state, files: counts, ready: false };
    }
    for (const detail of details) {
      const summary = sets[detail.set] as UnitSetSummary;
      summary.draftAllowed = catalogItem !== undefined;
      summary.blockers = [...evidenceBlockers, ...detail.needs.filter((need) => {
        const target = sets[need] ?? application.summaries[need];
        // A unit dependency deliberately inapplicable to this kind has nothing to generate.
        const definition = project.sets.find((loaded) => loaded.set.id === need);
        const inapplicable = definition !== undefined && definition.set.scope !== "application" && designFilesFor(definition, kind).length === 0;
        return !inapplicable && (target === undefined || !finished(target.state));
      }).map((need) => `Needs the merged, conformant ${need} design first.`)];
      summary.ready = summary.blockers.length === 0 && summary.state === "missing" && summary.files.conformant + summary.files.problems === 0;
    }
    const coverage: UnitCoverageRow[] = rules
      .map((rule) => ({ rule: rule.id, title: rule.title, coveredBy: coveredBy.get(rule.id) ?? [] }))
      .sort((a, b) => Number(a.coveredBy.length > 0) - Number(b.coveredBy.length > 0));
    const row: UnitDesignRow = {
      key: `${module}/${unit}`,
      module,
      unit,
      kind,
      ...(summary.title === undefined ? {} : { title: summary.title }),
      ...(textOf(data["wave"], 40) === undefined ? {} : { wave: textOf(data["wave"], 40) as string }),
      ...(summary.assignee === undefined ? {} : { owner: summary.assignee }),
      sets,
      rules: { total: rules.length, uncovered: coversRules ? uncoveredIds.size : null },
    };
    return { row, details, coverage, unresolved, componentRefs, anyStale };
  }
}
