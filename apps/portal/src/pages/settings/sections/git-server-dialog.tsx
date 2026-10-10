// Git server dialog (ADR-0025): a server is a host plus one credential — an HTTPS token
// or an SSH key with the host keys pinned for it. Credentials are write-only: editing
// shows them blank and keeps the stored one unless a new value is entered. The form
// mounts fresh each time the dialog opens.

import { GIT_SERVER_KINDS, type GitServerKind } from "@kintsugi/domain";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Field } from "../../../components/ui/field";
import { Input } from "../../../components/ui/input";
import { Modal } from "../../../components/ui/modal";
import { Select } from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import type { GitAuthType, GitServerInput, GitServerView } from "../../../lib/api/git";

const SERVER_ID = /^[a-z0-9][a-z0-9-]*$/;

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
  const [id, setId] = useState(server?.id ?? "");
  const [name, setName] = useState(server?.name ?? "");
  const [kind, setKind] = useState<GitServerKind>(server?.kind ?? "github");
  const [baseUrl, setBaseUrl] = useState(server?.baseUrl ?? "");
  const [authType, setAuthType] = useState<GitAuthType>(server?.authType ?? "token");
  const [username, setUsername] = useState(server?.username ?? "");
  const [token, setToken] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [knownHosts, setKnownHosts] = useState(server?.knownHosts ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A stored credential can be kept only for the same auth type.
  const storedCredential = editing && server.hasCredential && server.authType === authType;

  function validate(): string | GitServerInput {
    if (!editing && !SERVER_ID.test(id)) return "Id: lowercase letters, digits and dashes.";
    if (!editing && existingIds.includes(id)) return `A server "${id}" already exists.`;
    if (name.trim() === "") return "Name is required.";
    if (!/^https?:\/\/\S+$/.test(baseUrl.trim())) return "Base URL must start with https:// (or http:// for anonymous internal servers).";
    if (authType === "token" && token === "" && !storedCredential) return "Enter the access token.";
    if (authType === "ssh-key" && privateKey === "" && !storedCredential) return "Paste the SSH private key.";
    if (authType === "ssh-key" && knownHosts.trim() === "") return "Pin the server's SSH host keys (known_hosts lines).";
    return {
      kind,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      authType,
      ...(authType === "token" && username.trim() !== "" ? { username: username.trim() } : {}),
      ...(authType === "token" && token !== "" ? { token } : {}),
      ...(authType === "ssh-key" && privateKey !== "" ? { privateKey } : {}),
      ...(authType === "ssh-key" ? { knownHosts: knownHosts.trim() } : {}),
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
      description="Kintsugi clones registered repositories into its own storage with this credential. The credential is encrypted and only ever sent to this server's host."
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
          {editing ? null : (
            <Field label="Id" hint="Used in storage paths; cannot change later.">
              <Input value={id} placeholder="github-org" onChange={(event) => setId(event.target.value.trim())} />
            </Field>
          )}
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

        {error === null ? null : (
          <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
