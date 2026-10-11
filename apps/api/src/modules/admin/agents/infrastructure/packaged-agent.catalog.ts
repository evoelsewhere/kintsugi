// The built-in catalog shipped with the release (packages/agents/builtin), loaded once, and
// the kernel tool names (importable without pi).

import { Injectable } from "@nestjs/common";
import { type BuiltinCatalog, loadBuiltinCatalog } from "@kintsugi/agents";
import { KERNEL_TOOL_NAMES } from "@kintsugi/runtime/tool-names";
import { AgentCatalog } from "../domain/agent.repository.js";

@Injectable()
export class PackagedAgentCatalog extends AgentCatalog {
  readonly kernelTools: readonly string[] = KERNEL_TOOL_NAMES;
  #catalog: Promise<BuiltinCatalog> | undefined;

  builtin(): Promise<BuiltinCatalog> {
    this.#catalog ??= loadBuiltinCatalog().catch((error: unknown) => {
      this.#catalog = undefined;
      throw error;
    });
    return this.#catalog;
  }
}
