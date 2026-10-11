// Repository dialog (ADR-0025): pick a server, paste the clone URL, test access, add.
// Kintsugi checks the repository is reachable with the server's credential before it
// registers it; the worker then clones it into Kintsugi's storage.

import { PlugZap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import { gitApi, type GitServerView, type TestAccessResult } from "@/lib/api/git";

const REPOSITORY_ID = /^[a-z0-9][a-z0-9-]*$/;

/** "https://host/org/legacy-app.git" → "legacy-app". */
function idFromUrl(url: string): string {
  const last = url.trim().replace(/\/+$/, "").split(/[/:]/).at(-1) ?? "";
  return last
    .replace(/\.git$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface GitRepositoryDialogProps {
  open: boolean;
  servers: GitServerView[];
  existingIds: string[];
  onClose: () => void;
  onSubmit: (input: { id: string; serverId: string; url: string }) => Promise<void>;
}

export function GitRepositoryDialog(props: GitRepositoryDialogProps): React.JSX.Element | null {
  return props.open ? <GitRepositoryForm {...props} /> : null;
}

function GitRepositoryForm({ servers, existingIds, onClose, onSubmit }: GitRepositoryDialogProps): React.JSX.Element {
  const [serverId, setServerId] = useState(servers[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [test, setTest] = useState<TestAccessResult | "testing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const server = servers.find((entry) => entry.id === serverId);
  const effectiveId = idEdited ? id : idFromUrl(url);

  async function runTest(): Promise<void> {
    if (serverId === "" || url.trim() === "") return;
    setTest("testing");
    try {
      setTest(await gitApi.testAccess(serverId, url.trim()));
    } catch (failure) {
      setTest({ ok: false, message: failure instanceof Error ? failure.message : String(failure) });
    }
  }

  async function submit(): Promise<void> {
    if (serverId === "") return setError("Add a Git server first.");
    if (url.trim() === "") return setError("Paste the repository's clone URL.");
    if (!REPOSITORY_ID.test(effectiveId)) return setError("Id: lowercase letters, digits and dashes.");
    if (existingIds.includes(effectiveId)) return setError(`A repository "${effectiveId}" already exists.`);
    setError(null);
    setSaving(true);
    try {
      await onSubmit({ id: effectiveId, serverId, url: url.trim() });
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
      title="Add repository"
      description="Kintsugi keeps its own read-only mirror of the repository; members keep working in their own clones."
      onClose={onClose}
      footer={
        <>
          <Button size="small" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="small" variant="solid" disabled={saving} onClick={() => void submit()}>
            {saving ? "Checking access…" : "Add repository"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Server">
          <Select
            value={serverId}
            placeholder="No servers yet"
            options={servers.map((entry) => ({ value: entry.id, label: entry.name, hint: entry.baseUrl }))}
            onChange={(value) => {
              setServerId(value);
              setTest(null);
            }}
          />
        </Field>
        <Field
          label="Clone URL"
          hint={
            server?.authType === "ssh-key"
              ? "SSH form, e.g. git@host:org/repo.git, on a host whose key is pinned for this server."
              : "HTTPS clone URL on this server's host, without credentials."
          }
        >
          <div className="flex items-center gap-2">
            <Input
              value={url}
              placeholder={server?.authType === "ssh-key" ? "git@github.com:org/repo.git" : `${server?.baseUrl ?? "https://github.com"}/org/repo.git`}
              onChange={(event) => {
                setUrl(event.target.value);
                setTest(null);
              }}
            />
            <Button size="small" variant="ghost" disabled={serverId === "" || url.trim() === "" || test === "testing"} onClick={() => void runTest()}>
              <PlugZap className="size-4" />
              Test access
            </Button>
          </div>
        </Field>
        {test === null ? null : (
          <p className="flex items-center gap-1.5 text-[12px] text-text-secondary">
            <StatusDot tone={test === "testing" ? "muted" : test.ok ? "green" : "red"} />
            {test === "testing" ? "Testing…" : test.message}
          </p>
        )}
        <Field label="Id" hint="Derived from the URL; used in storage paths.">
          <Input
            value={effectiveId}
            placeholder="legacy-app"
            onChange={(event) => {
              setIdEdited(true);
              setId(event.target.value.trim());
            }}
          />
        </Field>
        {error === null ? null : (
          <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
