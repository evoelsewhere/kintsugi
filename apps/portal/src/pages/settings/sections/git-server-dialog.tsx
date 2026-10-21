// Git server dialog (ADR-0025): a server is a host plus one credential — an HTTPS token
// or an SSH key with the host keys pinned for it. Credentials are write-only: editing
// shows them blank and keeps the stored one unless a new value is entered. The form
// mounts fresh each time the dialog opens.

import { GIT_SERVER_KINDS, type GitServerKind } from "@kintsugi/domain";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { GitAuthType, GitServerInput, GitServerView } from "@/lib/api/git";
import { uniqueId } from "@/lib/ids";
import { githubAppInputProblem } from "./git-server-dialog-model";

const KIND_LABELS: Record<GitServerKind, string> = {
  github: "GitHub",
  "github-enterprise": "GitHub Enterprise Server",
  "azure-devops": "Azure DevOps",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  gitea: "Gitea",
  "plain-git": "Plain Git (no pull request API)",
};

const AUTH_OPTIONS: { value: GitAuthType; label: string; hint: string }[] = [
  { value: "token", label: "Access token (HTTPS)", hint: "recommended" },
  { value: "ssh-key", label: "SSH key", hint: "with pinned host keys" },
  { value: "none", label: "Anonymous", hint: "public or internal read" },
];

export interface GitServerDialogProps {
  open: boolean;
  server: GitServerView | null;
  existingIds: string[];
  onClose: () => void;
  onSubmit: (id: string, input: GitServerInput) => Promise<void>;
}

export function GitServerDialog(props: GitServerDialogProps): React.JSX.Element | null {
  return props.open ? <GitServerForm {...props} /> : null;
}

function GitServerForm({ server, existingIds, onClose, onSubmit }: GitServerDialogProps): React.JSX.Element {
  const editing = server !== null;
  const [name, setName] = useState(server?.name ?? "");
  const id = server?.id ?? uniqueId(name, existingIds);
  const [kind, setKind] = useState<GitServerKind>(server?.kind ?? "github");
  const [baseUrl, setBaseUrl] = useState(server?.baseUrl ?? "");
  const [authType, setAuthType] = useState<GitAuthType>(server?.authType ?? "token");
  const [username, setUsername] = useState(server?.username ?? "");
  const [token, setToken] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [knownHosts, setKnownHosts] = useState(server?.knownHosts ?? "");
  const [githubAppEnabled, setGithubAppEnabled] = useState(server?.githubApp !== undefined);
  const [githubAppId, setGithubAppId] = useState(server?.githubApp?.appId ?? "");
  const [githubInstallationId, setGithubInstallationId] = useState(server?.githubApp?.installationId ?? "");
  const [githubAppPrivateKey, setGithubAppPrivateKey] = useState("");
  const [githubWebhookSecret, setGithubWebhookSecret] = useState("");
  const [removeGithubWebhookSecret, setRemoveGithubWebhookSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const showGithubApp = kind === "github" || kind === "github-enterprise" || server?.githubApp !== undefined || server?.hasGithubWebhookSecret === true;
  const storedGithubWebhookSecret = server?.hasGithubWebhookSecret === true;
  const storedGithubAppKey = server?.githubApp?.hasPrivateKey === true;
  const canKeepGithubAppKey = storedGithubAppKey && githubAppId.trim() === server?.githubApp?.appId && githubInstallationId.trim() === server?.githubApp?.installationId;

  // A stored credential can be kept only for the same auth type.
  const storedCredential = editing && server.hasCredential && server.authType === authType;

  function validate(): string | GitServerInput {
    if (name.trim() === "") return "Name is required.";
    if (!editing && id === "") return "The name needs at least one letter or digit.";
    if (!/^https?:\/\/\S+$/.test(baseUrl.trim())) return "Base URL must start with https:// (or http:// for anonymous internal servers).";
    if (authType === "token" && token === "" && !storedCredential) return "Enter the access token.";
      if (githubWebhookSecret !== "" && githubWebhookSecret.trim().length < 32) return "Webhook secrets must be at least 32 characters.";
    if (authType === "ssh-key" && privateKey === "" && !storedCredential) return "Paste the SSH private key.";
    if (authType === "ssh-key" && knownHosts.trim() === "") return "Pin the server's SSH host keys (known_hosts lines).";
    const githubApp = githubAppInputProblem({
      kind,
      baseUrl,
      server,
      draft: { enabled: githubAppEnabled, appId: githubAppId, installationId: githubInstallationId, privateKey: githubAppPrivateKey },
    });
    if ("error" in githubApp) return githubApp.error;
    return {
      kind,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      authType,
      ...(authType === "token" && username.trim() !== "" ? { username: username.trim() } : {}),
      ...(authType === "token" && token !== "" ? { token } : {}),
      ...(authType === "ssh-key" && privateKey !== "" ? { privateKey } : {}),
      ...(authType === "ssh-key" ? { knownHosts: knownHosts.trim() } : {}),
        ...(removeGithubWebhookSecret ? { githubWebhookSecret: null } : githubWebhookSecret.trim() !== "" ? { githubWebhookSecret } : {}),
      ...githubApp,
    };
  }

  async function submit(): Promise<void> {
    const input = validate();
    if (typeof input === "string") return setError(input);
    setError(null);
    setSaving(true);
    try {
      await onSubmit(editing ? server.id : id, input);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="nested"
      title={editing ? `Configure ${server.id}` : "Add Git server"}
      description="Kintsugi clones registered repositories with the clone credential. GitHub pull-request observation can use an App and an optional signed webhook secret; credentials are encrypted and never shown after saving."
      onClose={onClose}
      footer={
        <>
          <Button size="small" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="small" variant="solid" disabled={saving} onClick={() => void submit()}>
            {saving ? "Saving…" : editing ? "Save" : "Add server"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} placeholder="GitHub (org)" onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Kind">
            <Select value={kind} options={GIT_SERVER_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }))} onChange={(value) => setKind(value as GitServerKind)} />
          </Field>
          <Field label="Base URL" hint="Web address of the server, e.g. https://github.com or https://dev.azure.com/org.">
            <Input value={baseUrl} placeholder="https://github.com" onChange={(event) => setBaseUrl(event.target.value)} />
          </Field>
        </div>

        <Field label="Authentication">
          <Select value={authType} options={AUTH_OPTIONS} onChange={(value) => setAuthType(value as GitAuthType)} />
        </Field>

        {authType === "token" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
            <Field label="Username" hint="Optional; most servers ignore it.">
              <Input value={username} placeholder="kintsugi" autoComplete="off" onChange={(event) => setUsername(event.target.value)} />
            </Field>
            <Field label="Access token" hint="Read access to the repositories; write access for the document repo.">
              <Input
                type="password"
                autoComplete="new-password"
                value={token}
                placeholder={storedCredential ? "Stored — leave blank to keep" : "token"}
                onChange={(event) => setToken(event.target.value)}
              />
            </Field>
          </div>
        ) : null}

        {authType === "ssh-key" ? (
          <>
            <Field label="Private key" hint="OpenSSH format, without a passphrase. Prefer a deploy key.">
              <Textarea
                mono
                rows={4}
                value={privateKey}
                spellCheck={false}
                autoComplete="off"
                placeholder={storedCredential ? "Stored — leave blank to keep" : "-----BEGIN OPENSSH PRIVATE KEY-----"}
                onChange={(event) => setPrivateKey(event.target.value)}
              />
            </Field>
            <Field label="Pinned host keys" hint="known_hosts lines, e.g. from `ssh-keyscan github.com`; verify the fingerprints. Kintsugi never trusts a host on first use.">
              <Textarea mono rows={3} value={knownHosts} spellCheck={false} placeholder="github.com ssh-ed25519 AAAA…" onChange={(event) => setKnownHosts(event.target.value)} />
            </Field>
          </>
        ) : null}

        {showGithubApp ? (
          <section aria-label="GitHub pull-request integration" className="rounded-[var(--geist-radius)] bg-recessed/50 p-3">
              <Field label="Webhook secret" hint="Optional. Use a random secret with at least 32 characters and set it on a GitHub webhook targeting /api/webhooks/github/{server-id}. Kintsugi still fetches current PR state; polling works without a webhook.">
              <Input
                type="password"
                autoComplete="new-password"
                value={githubWebhookSecret}
                maxLength={8192}
                placeholder={storedGithubWebhookSecret ? "Stored — leave blank to keep" : "Optional webhook secret"}
                onChange={(event) => {
                  setGithubWebhookSecret(event.target.value);
                  if (event.target.value !== "") setRemoveGithubWebhookSecret(false);
                }}
              />
            </Field>
            {storedGithubWebhookSecret ? (
              <Checkbox checked={removeGithubWebhookSecret} onChange={setRemoveGithubWebhookSecret} label="Remove the stored webhook secret" />
            ) : null}
            <div className="flex flex-col gap-1">
              <Checkbox
                checked={githubAppEnabled}
                onChange={setGithubAppEnabled}
                label="Use a GitHub App for pull-request observation"
              />
              <p className="pl-6 text-[12px] leading-4 text-text-muted">
                Separate from clone authentication. Install the App on each repository with Pull requests: read and Checks: read; Kintsugi requests repository-scoped read tokens.
              </p>
              {!githubAppEnabled && server?.githubApp !== undefined ? (
                <p className="pl-6 text-[12px] leading-4 text-text-muted">The stored App configuration will be removed when you save.</p>
              ) : null}
            </div>
            {githubAppEnabled ? (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="GitHub App ID">
                  <Input
                    value={githubAppId}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={30}
                    placeholder="123456"
                    onChange={(event) => setGithubAppId(event.target.value)}
                  />
                </Field>
                <Field label="Installation ID">
                  <Input
                    value={githubInstallationId}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={30}
                    placeholder="987654321"
                    onChange={(event) => setGithubInstallationId(event.target.value)}
                  />
                </Field>
                <Field
                  label="App private key"
                  hint="RSA PEM key. Encrypted by Kintsugi and never shown after saving."
                  className="sm:col-span-2"
                >
                  <Textarea
                    mono
                    rows={4}
                    value={githubAppPrivateKey}
                    spellCheck={false}
                    autoComplete="off"
                    maxLength={16384}
                    placeholder={canKeepGithubAppKey ? "Stored — leave blank to keep" : "-----BEGIN RSA PRIVATE KEY-----"}
                    onChange={(event) => setGithubAppPrivateKey(event.target.value)}
                  />
                </Field>
              </div>
            ) : null}
          </section>
        ) : null}

        {error === null ? null : (
          <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
