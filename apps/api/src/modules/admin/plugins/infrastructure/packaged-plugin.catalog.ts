// The built-in plugins shipped with the release (packages/agents/builtin/plugins.json), loaded once.

import { Injectable } from "@nestjs/common";
import { type BuiltinPlugin, loadBuiltinPlugins, readBuiltinPluginFile } from "@kintsugi/agents";
import { PluginCatalog } from "../domain/plugin.catalog.js";

@Injectable()
export class PackagedPluginCatalog extends PluginCatalog {
  #plugins: Promise<BuiltinPlugin[]> | undefined;

  list(): Promise<BuiltinPlugin[]> {
    this.#plugins ??= loadBuiltinPlugins().catch((error: unknown) => {
      this.#plugins = undefined; // the next call retries
      throw error;
    });
    return this.#plugins;
  }

  async file(plugin: string, path: string): Promise<string | undefined> {
    return readBuiltinPluginFile(await this.list(), plugin, path);
  }
}
