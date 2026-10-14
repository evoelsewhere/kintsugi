// Use cases of the plugin catalog: list the plugins, open one, read one of its files.

import { Injectable, NotFoundException } from "@nestjs/common";
import type { BuiltinPlugin } from "@kintsugi/agents";
import { PluginCatalog } from "../domain/plugin.catalog.js";
import type { PluginDetail, PluginFileContent, PluginSummary } from "../domain/plugin.js";

function summary(plugin: BuiltinPlugin): PluginSummary {
  const counts: Record<string, number> = {};
  for (const component of plugin.components) counts[component.kind] = (counts[component.kind] ?? 0) + 1;
  return { name: plugin.name, title: plugin.title, version: plugin.version, description: plugin.description, audience: plugin.audience, source: "builtin", counts };
}

@Injectable()
export class PluginsService {
  constructor(private readonly catalog: PluginCatalog) {}

  async list(): Promise<PluginSummary[]> {
    return (await this.catalog.list()).map(summary);
  }

  async get(name: string): Promise<PluginDetail> {
    const plugin = (await this.catalog.list()).find((entry) => entry.name === name);
    if (plugin === undefined) throw new NotFoundException(`Plugin ${name} not found`);
    return { ...summary(plugin), components: plugin.components, files: plugin.files, flows: plugin.flows, pipeline: plugin.pipeline };
  }

  async file(name: string, path: string): Promise<PluginFileContent> {
    const content = await this.catalog.file(name, path);
    if (content === undefined) throw new NotFoundException(`Plugin ${name} has no file ${path}`);
    return { path, content };
  }
}
