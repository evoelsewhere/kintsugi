import { useCallback, useEffect, useState } from "react";
import { ClipboardCopy, RefreshCw, Shield, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { memberApi, type MemberTokenMetadata } from "@/lib/api/member";
import type { CodingAgentConnectionMetadata } from "@/lib/api/coding-agent-security";
import { errorText, formatDateTime } from "@/lib/format";
import { buildPluginInstallCommand, safeProfileName, type InstallShell } from "./install-model";

type InstallClientChoice = "claude-code" | "codex-desktop" | "codex-cli";

export function MemberConnectPanel({ projectId, canManage, canRead }: { projectId: string; canManage: boolean; canRead: boolean }): React.JSX.Element {
  const toast = useToast();
  const [tokens, setTokens] = useState<MemberTokenMetadata[]>([]);
  const [connections, setConnections] = useState<CodingAgentConnectionMetadata[]>([]);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [clientChoice, setClientChoice] = useState<InstallClientChoice>("codex-desktop");
  const [shell, setShell] = useState<InstallShell>("powershell");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = safeProfileName(projectId);
  let setup: string | undefined;
  let setupError: string | null = null;
  try {
    if (baseUrl !== null) setup = buildPluginInstallCommand({
      baseUrl,
      projectId,
      harness: clientChoice === "claude-code" ? "claude-code" : "codex",
      installMode: clientChoice === "codex-desktop" ? "desktop-ui" : "native-cli",
      profileId: profile,
      shell,
    });
  } catch (failure) {
    setupError = errorText(failure);
  }

  const load = useCallback(async (): Promise<void> => {
    try {
      const [installation, memberConnections, legacyTokens] = await Promise.all([
        memberApi.installation(),
        canRead ? memberApi.connections() : Promise.resolve([]),
        canManage ? memberApi.tokens() : Promise.resolve({ items: [] }),
      ]);
      setBaseUrl(installation.baseUrl);
      setConnections(memberConnections.filter((connection) => connection.projectIds.includes(projectId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setTokens(legacyTokens.items.filter((token) => token.projectIds.includes(projectId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setError(null);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setLoading(false);
    }
  }, [projectId, canRead, canManage]);

  // load() updates state only after its API request settles.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canRead || canManage) void load(); }, [load, canRead, canManage]);

  async function revoke(tokenId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await memberApi.revokeToken(tokenId);
      toast.success("Member token revoked");
      await load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function revokeConnection(connectionId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await memberApi.revokeConnection(connectionId);
      toast.success("Connection revoked");
      await load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      setError("Clipboard access is unavailable. Select and copy the text manually.");
    }
  }

  return (
    <section aria-labelledby="member-token-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="member-token-heading" className="text-[15px] font-medium text-text">Connect your coding agent</h2>
          <p className="mt-0.5 max-w-2xl text-[12px] text-text-muted">Install the Kintsugi connector once. The agent signs in through Kintsugi the first time it needs project context.</p>
        </div>
        {(canRead || canManage) ? <Button size="icon" variant="ghost" aria-label="Refresh member access" onClick={() => { setLoading(true); void load(); }}><RefreshCw className="size-4" /></Button> : null}
      </div>
      {!canRead ? <p className="text-[12px] text-text-muted">Your account needs <code>member.read</code> and Project Access to connect a coding agent.</p> : <>
        <div className="rounded-lg bg-surface shadow-border">
          <div className="flex flex-wrap items-center gap-2 px-3.5 py-3 [box-shadow:inset_2px_0_0_0_var(--ds-accent)]">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-text">{clientChoice === "codex-desktop" ? "Prepare for Codex Desktop" : "One-time install"}</p>
              <p className="mt-0.5 text-[12px] text-text-muted">Install the Kintsugi CLI first (it is built from packages/cli). Codex Desktop uses this command to prepare its local marketplace; you finish installation in the app.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2 px-3.5 pb-3.5">
            <Field label="AI client" className="w-44">
              <Select value={clientChoice} options={[{ value: "codex-desktop", label: "Codex Desktop" }, { value: "codex-cli", label: "Codex CLI" }, { value: "claude-code", label: "Claude Code" }]} onChange={(value) => setClientChoice(value as InstallClientChoice)} />
            </Field>
            <Field label="Terminal" className="w-44">
              <Select value={shell} options={[{ value: "powershell", label: "PowerShell" }, { value: "posix", label: "macOS / Linux" }]} onChange={(value) => setShell(value as InstallShell)} />
            </Field>
            <Button size="small" variant="ghost" disabled={setup === undefined} onClick={() => { if (setup !== undefined) void copy(setup, clientChoice === "codex-desktop" ? "Preparation command" : "Install command"); }}><ClipboardCopy className="size-3.5" />Copy command</Button>
          </div>
          <pre aria-label="Generated connector install command" className="overflow-x-auto bg-recessed px-3.5 py-2.5 font-mono text-[11px] leading-5 text-text">{setup ?? (loading ? "Loading the configured Kintsugi URL…" : "Install command is unavailable. Contact your Kintsugi administrator.")}</pre>
          <p className="px-3.5 py-2.5 text-[11px] text-text-muted">{clientChoice === "codex-desktop" ? "Restart Codex Desktop, then open Plugins → Plugins Directory → Kintsugi marketplace and install the plugin. In a new local chat, first use opens Kintsugi sign-in in your browser." : `After install, start a new ${clientChoice === "claude-code" ? "Claude Code" : "Codex CLI"} session. First use opens Kintsugi sign-in in your browser.`}</p>
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-text"><Shield className="size-3.5 text-text-muted" />Your connections</h3>
          {loading ? <p className="text-[11px] text-text-muted">Loading connection status…</p> : connections.length === 0 ? <p className="text-[11px] text-text-muted">No coding agent is connected to this project yet.</p> : <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
            {connections.map((connection) => <li key={connection.id} className="flex flex-wrap items-center gap-2 py-2 text-[12px]">
              <span className="min-w-0 flex-1 text-text">{connection.clientName} · connected {formatDateTime(connection.createdAt)}</span>
              {connection.revokedAt === undefined ? <Button size="small" variant="danger" disabled={busy} onClick={() => void revokeConnection(connection.id)}><Trash2 className="size-3.5" />Revoke</Button> : <span className="text-text-muted">Revoked</span>}
            </li>)}
          </ul>}
        </div>
        {canManage && tokens.length > 0 ? <details className="text-[12px] text-text-secondary">
          <summary className="cursor-pointer">Existing legacy tokens ({tokens.length})</summary>
          <p className="mt-1 text-[11px] text-text-muted">These older tokens remain revocable, but new connections use browser sign-in.</p>
          <ul className="mt-1 divide-y divide-black/[0.06] dark:divide-white/[0.08]">
            {tokens.map((token) => <li key={token.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1">{token.name} · {formatDateTime(token.expiresAt)}</span>
              {token.revokedAt === undefined ? <Button size="small" variant="danger" disabled={busy} onClick={() => void revoke(token.id)}><Trash2 className="size-3.5" />Revoke old token</Button> : <span className="text-text-muted">Revoked</span>}
            </li>)}
          </ul>
        </details> : null}
      </>}
      {error === null && setupError === null ? null : <p role="alert" className="text-[12px] text-[var(--ds-status-red)]">{error ?? setupError}</p>}
    </section>
  );
}
