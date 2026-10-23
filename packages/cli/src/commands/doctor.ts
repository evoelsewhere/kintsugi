import type { Command } from "commander";
import type { CliDeps } from "../cli.js";
import { CliError } from "../profile.js";
import { emit, selectedProfile } from "./shared.js";

export function registerDoctorCommand(program: Command, deps: CliDeps): void {
  program.command("doctor").description("Check local CLI, profile, credential, and API access").action(async function(this: Command) {
    const version = process.versions.node.split(".").map(Number);
    const runtimeSupported = (version[0] ?? 0) > 22 || ((version[0] ?? 0) === 22 && (version[1] ?? 0) >= 19);
    const report: Record<string, unknown> = { node: process.versions.node, runtimeSupported, profile: null, credentialStore: "unavailable", api: "not checked" };
    try {
      const { profile } = await selectedProfile(deps, this);
      report.profile = { id: profile.id, baseUrl: profile.baseUrl, projectId: profile.projectId ?? null, privateCaConfigured: profile.caFile !== undefined };
      const token = await deps.credentials.get(profile.id);
      report.credentialStore = token === undefined ? "no credential" : "available";
      if (token !== undefined) {
        const { apiFor } = await import("./shared.js");
        const { client } = await apiFor(deps, this);
        await client.listProjects({ limit: 1 });
        report.api = "reachable and authorized";
      }
    } catch (error) {
      report.api = error instanceof Error ? error.message : "check failed";
    }
    if (report.api !== "reachable and authorized" || !runtimeSupported) throw Object.assign(new CliError("DOCTOR_CHECK_FAILED", "One or more Kintsugi checks need attention"), { details: report });
    emit(deps, this, report);
  });
}
