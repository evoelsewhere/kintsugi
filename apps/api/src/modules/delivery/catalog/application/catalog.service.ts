// Application layer: the item catalog of an application (ADR-0033) with a derived status per
// item. The catalog is read at a ref (default: the default branch); the understood state
// (`unitMetaPath`) always at the default branch; the
// running, in-pr and failed states from the application's understand runs and the refs logic of
// the documents module (a run's branch is open until it is reachable from the default branch).

import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { type ItemCatalog, parseItemCatalog } from "@kintsugi/agents/reader";
import { type ItemStatus, catalogPath, unitMetaPath, unitModuleDir } from "@kintsugi/domain";
import { type DocumentContext, DocumentsService } from "#modules/delivery/documents/index.js";
import { JobRunsService, type JobRunView } from "#modules/delivery/runtime-jobs/index.js";
import { type CatalogItemView, type CatalogView, type ItemMeta, type UnderstandRunFacts, deriveItemStatus } from "../domain/catalog.js";

/** The understand stage's id (ADR-0033). */
export const UNDERSTAND_STAGE = "understand";
/** How many recent runs of the application are looked at. */
const RECENT_RUNS = 200;
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_META_BYTES = 64 * 1024;

/** A catalog read at a ref, with the document context it was read in. */
export interface LoadedCatalog {
  context: DocumentContext;
  ref: { ref: string; commit: string };
  catalog: ItemCatalog;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Items whose own (forEach) step failed, from a run's summary steps. */
function failedItems(run: JobRunView): string[] {
  const steps = run.outputSummary?.["steps"];
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step) => (isRecord(step) && step["status"] === "failed" && typeof step["key"] === "string" ? [step["key"]] : []));
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly documents: DocumentsService,
    private readonly runs: JobRunsService,
  ) {}

  /** The catalog at a ref; 404 for an unknown application or when no catalog is there, 409 when it is not a catalog. */
  async load(projectId: string, applicationId: string, ref: string | undefined): Promise<LoadedCatalog> {
    const context = await this.documents.context(projectId);
    if (!context.project.applications.some((application) => application.id === applicationId)) {
      throw new NotFoundException(`Application ${applicationId} not found in project ${projectId}`);
    }
    const resolved = await this.documents.resolve(context, ref);
    const text = await this.documents.readText(context, resolved.commit, catalogPath(applicationId), MAX_CATALOG_BYTES);
    if (text === undefined) throw new NotFoundException(`${catalogPath(applicationId)} is not at ${resolved.ref}: run assess for ${applicationId} and merge its pull request`);
    const catalog = parseItemCatalog(text);
    if (catalog === null) throw new ConflictException(`${catalogPath(applicationId)} at ${resolved.ref} is not an item catalog`);
    return { context, ref: resolved, catalog };
  }

  async view(projectId: string, applicationId: string, ref: string | undefined): Promise<CatalogView> {
    const loaded = await this.load(projectId, applicationId, ref);
    return this.withStatus(loaded, applicationId);
  }

  /** The catalog's items with their derived status. */
  async withStatus(loaded: LoadedCatalog, applicationId: string): Promise<CatalogView> {
    const { context, catalog } = loaded;
    const [metas, runs] = await Promise.all([this.metas(context, applicationId, catalog), this.understandRuns(context, applicationId)]);
    const counts: Partial<Record<ItemStatus, number>> = {};
    const items: CatalogItemView[] = catalog.items.map((item) => {
      const view: CatalogItemView = { ...item, ...deriveItemStatus(item, metas.get(item.id), runs) };
      counts[view.status] = (counts[view.status] ?? 0) + 1;
      return view;
    });
    const { items: _items, ...rest } = catalog;
    return { ref: loaded.ref, catalog: rest, items, counts };
  }

  /** The understand runs of the application, newest first, with their pull-request state. */
  async understandRuns(context: DocumentContext, applicationId: string): Promise<UnderstandRunFacts[]> {
    const page = await this.runs.list(context.project.id, applicationId, { limit: RECENT_RUNS, offset: 0 });
    const runs = page.items.filter((run) => run.kind === "stage" && run.name === UNDERSTAND_STAGE);
    const { tips, defaultTip } = await this.documents.branchTips(context);
    return Promise.all(
      runs.map(async (run): Promise<UnderstandRunFacts> => {
        const write = run.documentWrite;
        const ref = write?.status === "pr-opened" || write?.status === "merged" ? await this.documents.runRef(context, run, tips, defaultTip) : undefined;
        return {
          id: run.id,
          status: run.status,
          at: run.finishedAt ?? run.startedAt ?? run.createdAt,
          items: run.scope?.items ?? [],
          failedItems: failedItems(run),
          ...(ref?.branch === undefined ? {} : { pr: { branch: ref.branch, ...(write?.prUrl === undefined ? {} : { url: write.prUrl }), state: ref.status === "open" ? "open" : "merged" } }),
          abandoned: run.abandonedAt !== undefined,
        };
      }),
    );
  }

  /** meta.json of every item understood on the default branch, by item id. */
  private async metas(context: DocumentContext, applicationId: string, catalog: ItemCatalog): Promise<Map<string, ItemMeta>> {
    const commit = (await this.documents.resolve(context, undefined)).commit;
    const metas = new Map<string, ItemMeta>();
    const modules = new Set(catalog.items.map((item) => item.id.split("/")[0]!));
    await Promise.all(
      [...modules].map(async (module) => {
        const present = new Set((await this.documents.listNames(context, commit, unitModuleDir(applicationId, module))).filter((entry) => entry.kind === "dir").map((entry) => entry.name));
        await Promise.all(
          catalog.items
            .filter((item) => item.id.startsWith(`${module}/`) && present.has(item.id.slice(module.length + 1)))
            .map(async (item) => {
              const text = await this.documents.readText(context, commit, unitMetaPath(applicationId, module, item.id.slice(module.length + 1)), MAX_META_BYTES);
              if (text === undefined) return;
              let raw: unknown;
              try {
                raw = JSON.parse(text);
              } catch {
                raw = {};
              }
              const meta = isRecord(raw) ? raw : {};
              const pick = (key: string): string | undefined => (typeof meta[key] === "string" ? meta[key] : undefined);
              const digest = pick("digest");
              const commitOf = pick("commit");
              const runId = pick("runId");
              metas.set(item.id, { ...(digest === undefined ? {} : { digest }), ...(commitOf === undefined ? {} : { commit: commitOf }), ...(runId === undefined ? {} : { runId }) });
            }),
        );
      }),
    );
    return metas;
  }
}
