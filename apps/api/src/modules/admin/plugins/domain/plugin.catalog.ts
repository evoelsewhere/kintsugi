// Port of the plugin catalog: the plugins an installation offers (today the built-in ones shipped
// with the release; project plugins of the document repository follow in a later phase).

import type { BuiltinPlugin } from "@kintsugi/agents";

export abstract class PluginCatalog {
  abstract list(): Promise<BuiltinPlugin[]>;
  /** The text of one file of a plugin; undefined when the plugin has no such file. */
  abstract file(plugin: string, path: string): Promise<string | undefined>;
}
