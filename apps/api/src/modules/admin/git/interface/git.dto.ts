// Interface layer: request schemas and HTTP-facing mapping for Git servers and
// repositories (ADR-0016: Standard Schema). Credentials are write-only fields.

import { GIT_SERVER_KINDS } from "@kintsugi/domain";
import { z } from "zod";
import { idSchema } from "#common/interface/dto.js";
import type { RegisterGitServer } from "../domain/git.js";

const serverFields = {
  kind: z.enum(GIT_SERVER_KINDS),
  name: z.string().min(1).max(100),
  /** Web/API base URL of the server, e.g. https://github.com. */
  baseUrl: z.url({ protocol: /^https?$/ }).max(2000),
  authType: z.enum(["none", "token", "ssh-key"]),
  /** HTTPS username sent with the token (optional; most servers ignore it). */
  username: z.string().min(1).max(200).optional(),
  /** Write-only. Personal access / project token for HTTPS. */
  token: z.string().min(1).max(8192).optional(),
  /** Write-only. OpenSSH private key for SSH. */
  privateKey: z.string().min(1).max(16384).optional(),
  /** Pinned SSH host keys (known_hosts lines), required with an SSH key. */
  knownHosts: z.string().max(16384).optional(),
  /** Write-only webhook secret; omit to keep it, null explicitly removes it. */
  githubWebhookSecret: z.string().min(32).max(8192).nullable().optional(),
  /** Write-only GitHub App configuration for PR/check observation; null explicitly removes it. */
  githubApp: z.object({
    appId: z.string().regex(/^\d+$/).max(30),
    installationId: z.string().regex(/^\d+$/).max(30),
    privateKey: z.string().min(1).max(16384),
  }).strict().nullable().optional(),
};

export const createGitServerSchema = z.object({ id: idSchema, ...serverFields });
export type CreateGitServerInput = z.infer<typeof createGitServerSchema>;

export const replaceGitServerSchema = z.object(serverFields);
export type ReplaceGitServerInput = z.infer<typeof replaceGitServerSchema>;

export const testAccessSchema = z.object({ url: z.string().min(1).max(2000) });
export type TestAccessInput = z.infer<typeof testAccessSchema>;

export const createGitRepositorySchema = z.object({
  id: idSchema,
  serverId: idSchema,
  /** Clone URL (https or ssh), without credentials. */
  url: z.string().min(1).max(2000),
});
export type CreateGitRepositoryInput = z.infer<typeof createGitRepositorySchema>;

/** Maps a server request to the application command. */
export function toServerCommand(id: string, input: ReplaceGitServerInput): RegisterGitServer {
  const { token, privateKey, username, knownHosts, githubApp, githubWebhookSecret, ...fields } = input;
  return {
    id,
    ...fields,
    ...(username === undefined ? {} : { username }),
    ...(knownHosts === undefined || knownHosts.trim() === "" ? {} : { knownHosts: knownHosts.trim() }),
    credential: { ...(token === undefined ? {} : { token }), ...(privateKey === undefined ? {} : { privateKey }) },
    ...(githubApp === undefined ? {} : { githubApp }),
    ...(githubWebhookSecret === undefined ? {} : { githubWebhookSecret }),
  };
}
