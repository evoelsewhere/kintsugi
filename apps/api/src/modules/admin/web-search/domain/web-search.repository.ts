import type { WebSearchSettings } from "@kintsugi/domain";
export abstract class WebSearchRepository {
  abstract view(projectId: string): Promise<WebSearchSettings | undefined>;
  abstract configure(projectId: string, settings: WebSearchSettings): Promise<void>;
}
