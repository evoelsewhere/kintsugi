import { createCodingAgentWorkflowClient, type CodingAgentWorkflowClientOptions } from "@kintsugi/kintsugi-client";
import type { Command } from "commander";
import type { CodingAgentWorkflowPort } from "@kintsugi/harness-sdk";
import type { CliDeps } from "../cli.js";
import { CliError } from "../profile.js";
import { createFetchWithPrivateCa } from "../tls.js";
import { formatResult, renderBriefText } from "../render.js";
import type { TaskBrief } from "@kintsugi/harness-sdk";
import { oauthFor } from "../oauth.js";

export type OutputFormat = "text" | "json" | "markdown";

export interface CommandOptions {
  format?: OutputFormat;
  json?: boolean;
  profile?: string;
  project?: string;
  noInput?: boolean;
  tokenStdin?: boolean;
}

export async function selectedProfile(deps: CliDeps, command: Command): Promise<{ config: Awaited<ReturnType<CliDeps["profiles"]["load"]>>; profile: NonNullable<Awaited<ReturnType<CliDeps["profiles"]["load"]>>["profiles"][string]> }> {
  const config = await deps.profiles.load();
  const options = command.optsWithGlobals() as CommandOptions;
  const profileId = options.profile ?? config.activeProfile;
  if (profileId === undefined || config.profiles[profileId] === undefined) throw new CliError("PROFILE_REQUIRED", "Choose a Kintsugi profile with --profile or run auth login first");
  return { config, profile: config.profiles[profileId]! };
}

export async function apiFor(deps: CliDeps, command: Command): Promise<{ client: CodingAgentWorkflowPort; profile: NonNullable<Awaited<ReturnType<CliDeps["profiles"]["load"]>>["profiles"][string]> }> {
  const { profile } = await selectedProfile(deps, command);
  const options = command.optsWithGlobals() as CommandOptions;
  let token: string | undefined;
  if (options.tokenStdin) {
    token = (await deps.readStdin()).trim();
  }
  else token = await oauthFor(deps).accessTokenFor(profile);
  if (token === undefined || token.length === 0) throw new CliError("CREDENTIAL_REQUIRED", "No credential is stored for this profile; run auth login");
  const fetcher = profile.caFile === undefined ? deps.fetch : await createFetchWithPrivateCa(profile.caFile);
  const clientOptions: CodingAgentWorkflowClientOptions = {
    baseUrl: profile.baseUrl,
    tokenProvider: options.tokenStdin ? async () => token : async () => {
      try { return await oauthFor(deps).accessTokenFor(profile); }
      catch (error) { if (error instanceof CliError && error.code === "CREDENTIAL_REQUIRED") return undefined; throw error; }
    },
    fetch: fetcher,
    sleep: deps.sleep,
    signalProvider: () => AbortSignal.any([AbortSignal.timeout(60_000), ...(deps.signal === undefined ? [] : [deps.signal])]),
  };
  return { client: createCodingAgentWorkflowClient(clientOptions), profile };
}

export function projectId(options: CommandOptions, profileProjectId?: string): string {
  const value = options.project ?? profileProjectId;
  if (value === undefined) throw new CliError("PROJECT_REQUIRED", "Choose a project with --project or run project use <project-id>");
  return value;
}

export function emit(deps: CliDeps, command: Command, value: unknown, markdown?: string): void {
  const options = command.optsWithGlobals() as CommandOptions;
  const format: OutputFormat = options.json ? "json" : options.format ?? "text";
  if (markdown !== undefined && format === "markdown") deps.stdout.write(`${markdown.trimEnd()}\n`);
  else if (markdown !== undefined && format === "text") deps.stdout.write(renderBriefText(value as TaskBrief));
  else deps.stdout.write(formatResult(value, format));
}

export function validateFormat(value: string): OutputFormat {
  if (value === "text" || value === "json" || value === "markdown") return value;
  throw new CliError("INVALID_FORMAT", "Format must be text, json, or markdown");
}

export async function apiForMcp(deps: CliDeps, command: Command): Promise<{ client: CodingAgentWorkflowPort; profile: NonNullable<Awaited<ReturnType<CliDeps["profiles"]["load"]>>["profiles"][string]> }> {
  const { profile } = await selectedProfile(deps, command);
  const options = command.optsWithGlobals() as CommandOptions;
  if (options.tokenStdin) throw new CliError("MCP_TOKEN_STDIN_UNSUPPORTED", "The MCP bridge uses stdin for protocol messages; authenticate the selected profile with auth login");
  if (options.project !== undefined) throw new CliError("MCP_PROJECT_SELECTOR_UNSUPPORTED", "MCP calls require explicit projectId arguments; --project is not a connection default");
  const oauth = oauthFor(deps);
  const fetcher = profile.caFile === undefined ? deps.fetch : await createFetchWithPrivateCa(profile.caFile);
  let authenticated = false;
  const tokenProvider = async (): Promise<string | undefined> => {
    try {
      const token = await oauth.accessTokenFor(profile);
      authenticated = true;
      return token;
    } catch (error) {
      if (!(error instanceof CliError) || !["CREDENTIAL_REQUIRED", "REAUTHENTICATION_REQUIRED"].includes(error.code)) throw error;
      if (authenticated && error.code === "CREDENTIAL_REQUIRED") return undefined;
      if (authenticated || options.noInput === true || (options as { input?: boolean }).input === false) throw error;
      if (profile.projectId === undefined) throw new CliError("PROJECT_REQUIRED", "This profile needs a project for browser consent; run auth login --url <url> --project <id>");
      await oauth.beginBrowserLogin(profile, profile.projectId, true);
      const token = await oauth.accessTokenFor(profile);
      authenticated = true;
      return token;
    }
  };
  return { client: createCodingAgentWorkflowClient({
    baseUrl: profile.baseUrl,
    tokenProvider,
    fetch: fetcher,
    sleep: deps.sleep,
    signalProvider: () => AbortSignal.any([AbortSignal.timeout(60_000), ...(deps.signal === undefined ? [] : [deps.signal])]),
  }), profile };
}
