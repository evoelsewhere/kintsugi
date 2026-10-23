import { resolve } from "node:path";
import type { Command } from "commander";
import type { CliDeps } from "../cli.js";
import { CliError, isProfileId, validateInstallationUrl } from "../profile.js";
import { emit, selectedProfile, type CommandOptions } from "./shared.js";
import { oauthFor, parseOAuthCredential } from "../oauth.js";
import { withCredentialLock } from "../oauth-lock.js";

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
      const project = options.project ?? prior?.projectId;
      const profile = { id, baseUrl, ...(project === undefined ? {} : { projectId: project }), ...((caFile ?? prior?.caFile) === undefined ? {} : { caFile: caFile ?? prior?.caFile }) };
      if (options.tokenStdin === true) {
        const token = (await deps.readStdin()).trim();
        if (token.length === 0 || /[\r\n]/.test(token)) throw new CliError("TOKEN_INVALID", "The token must be a non-empty single line");
        if (token.startsWith("knt_caw_") || token.startsWith("knt_crt_") || token.startsWith("{")) throw new CliError("TOKEN_INVALID", "OAuth credentials require browser sign-in; token-stdin only supports an existing legacy token");
        await withCredentialLock(id, () => deps.credentials.set(id, token), { ...(deps.signal === undefined ? {} : { signal: deps.signal }) });
      } else {
        if (options.noInput === true || (options as { input?: boolean }).input === false) throw new CliError("INPUT_REQUIRED", "Browser sign-in requires interaction; omit --no-input");
        if (project === undefined) throw new CliError("PROJECT_REQUIRED", "Choose the project to authorize with --project <id>");
        await oauthFor(deps).beginBrowserLogin(profile, project);
      }
      config.profiles[id] = profile;
      config.activeProfile = id;
      await deps.profiles.save(config);
      emit(deps, this, { profile: id, baseUrl, authenticated: true });
    });

  auth.command("status").description("Show the selected profile and credential availability").action(async function(this: Command) {
    const { profile } = await selectedProfile(deps, this);
    const credential = await deps.credentials.get(profile.id);
    const envelope = credential === undefined ? undefined : parseOAuthCredential(credential);
    emit(deps, this, { profile: profile.id, baseUrl: profile.baseUrl, projectId: profile.projectId ?? null, authenticated: credential !== undefined, ...(envelope === undefined ? {} : { connectionId: envelope.connectionId, projectIds: envelope.projectIds, authentication: "browser" }) });
  });

  auth.command("logout").description("Remove the selected profile credential").action(async function(this: Command) {
    const { profile } = await selectedProfile(deps, this);
    const legacy = await oauthFor(deps).logout(profile);
    if (legacy) deps.stderr.write("Legacy token removed locally. Revoke the legacy token in Kintsugi to disable other copies.\n");
    emit(deps, this, { profile: profile.id, authenticated: false });
  });
}
