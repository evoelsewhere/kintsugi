import { resolve } from "node:path";
import type { Command } from "commander";
import type { CliDeps } from "../cli.js";
import { CliError, isProfileId, validateInstallationUrl } from "../profile.js";
import { emit, selectedProfile, type CommandOptions } from "./shared.js";

export function registerAuthCommands(program: Command, deps: CliDeps): void {
  const auth = program.command("auth").description("Manage local Kintsugi credentials");
  auth.command("login")
    .description("Connect a profile to a Kintsugi installation")
    .requiredOption("--url <url>", "Kintsugi installation HTTPS URL")
    .option("--profile <id>", "Profile name")
    .option("--ca-file <path>", "Private CA PEM file for this installation")
    .option("--token-stdin", "Read token from stdin instead of the hidden prompt")
    .action(async function(this: Command) {
      const options = this.optsWithGlobals() as CommandOptions & { url: string; caFile?: string; tokenStdin?: boolean };
      const id = options.profile ?? "work";
      if (!isProfileId(id)) throw new CliError("PROFILE_ID_INVALID", "Profile name may contain letters, numbers, dot, underscore, and dash");
      const baseUrl = validateInstallationUrl(options.url);
      const config = await deps.profiles.load();
      const prior = config.profiles[id];
      if (prior !== undefined && prior.baseUrl !== baseUrl) throw new CliError("PROFILE_INSTALLATION_MISMATCH", "This profile belongs to a different Kintsugi installation; use a new profile name");
      let caFile: string | undefined;
      if (options.caFile !== undefined) {
        if (!baseUrl.startsWith("https://")) throw new CliError("HTTPS_REQUIRED", "A private CA can only be used with an HTTPS installation URL");
        caFile = resolve(deps.cwd, options.caFile!);
        await (await import("../tls.js")).createFetchWithPrivateCa(caFile);
      }
      let token: string;
      if (options.tokenStdin === true) token = (await deps.readStdin()).trim();
      else {
        if (options.noInput === true || (options as { input?: boolean }).input === false || !deps.isTTY) throw new CliError("INPUT_REQUIRED", "Use --token-stdin or run login in an interactive terminal");
        token = await deps.promptSecret();
      }
      if (token.length === 0 || /[\r\n]/.test(token)) throw new CliError("TOKEN_INVALID", "The token must be a non-empty single line");
      await deps.credentials.set(id, token);
      config.profiles[id] = { id, baseUrl, ...(prior?.projectId === undefined ? {} : { projectId: prior.projectId }), ...((caFile ?? prior?.caFile) === undefined ? {} : { caFile: caFile ?? prior?.caFile }) };
      config.activeProfile = id;
      await deps.profiles.save(config);
      emit(deps, this, { profile: id, baseUrl, authenticated: true });
    });

  auth.command("status").description("Show the selected profile and credential availability").action(async function(this: Command) {
    const { profile } = await selectedProfile(deps, this);
    const credential = await deps.credentials.get(profile.id);
    emit(deps, this, { profile: profile.id, baseUrl: profile.baseUrl, projectId: profile.projectId ?? null, authenticated: credential !== undefined });
  });

  auth.command("logout").description("Remove the selected profile credential").action(async function(this: Command) {
    const { profile } = await selectedProfile(deps, this);
    await deps.credentials.delete(profile.id);
    emit(deps, this, { profile: profile.id, authenticated: false });
  });
}
