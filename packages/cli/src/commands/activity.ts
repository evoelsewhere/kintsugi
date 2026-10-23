// The one write of the member base (ADR-0069): record a short, factual note about work a plugin helped with.
// It adds a line to Kintsugi's monitoring of the project and changes no project, document or repository.

import type { Command } from "commander";
import type { ActivityDetail } from "@kintsugi/harness-sdk";
import type { CliDeps } from "../cli.js";
import { CliError } from "../profile.js";
import { apiFor, emit, projectId, type CommandOptions } from "./shared.js";

function detailOf(entries: readonly string[]): ActivityDetail | undefined {
  if (entries.length === 0) return undefined;
  const detail: ActivityDetail = {};
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator < 1) throw new CliError("DETAIL_INVALID", "Each --detail must look like key=value");
    const key = entry.slice(0, separator);
    const raw = entry.slice(separator + 1);
    detail[key] = raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  return detail;
}

export function registerActivityCommands(program: Command, deps: CliDeps): void {
  const activity = program.command("activity").description("Record what a plugin did, for the project's monitoring");
  activity.command("record <kind>")
    .description("Record one note (kind: result, note, run, ...); never include document content, credentials or personal data")
    .option("--project <id>", "Project id")
    .option("--plugin <name>", "The plugin the note belongs to")
    .option("--harness <name>", "The kind of client, for example claude-code")
    .option("--summary <text>", "One short line")
    .option("--detail <key=value...>", "A scalar fact, repeatable")
    .action(async function(this: Command, kind: string) {
      const options = this.optsWithGlobals() as CommandOptions & { plugin?: string; harness?: string; summary?: string; detail?: string[] };
      const { client, profile } = await apiFor(deps, this);
      const detail = detailOf(options.detail ?? []);
      const receipt = await client.recordActivity({
        projectId: projectId(options, profile.projectId),
        kind,
        ...(options.plugin === undefined ? {} : { pluginName: options.plugin }),
        ...(options.harness === undefined ? {} : { harness: options.harness }),
        ...(options.summary === undefined ? {} : { summary: options.summary }),
        ...(detail === undefined ? {} : { detail }),
      });
      emit(deps, this, receipt);
    });
}
