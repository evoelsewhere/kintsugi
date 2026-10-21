import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, RefreshCw, Shield, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { agentContextApi, type MemberTokenMetadata, type ProjectAccessGrant } from "@/lib/api/agent-context";
import { identityApi, type UserRecord } from "@/lib/api/identity";
import { errorText, formatDateTime } from "@/lib/format";
import { clientSetupCommands, safeProfileName } from "./handoff";

export function MemberTokensPanel({ projectId, canManage, canRead }: { projectId: string; canManage: boolean; canRead: boolean }): React.JSX.Element {
  const toast = useToast();
  const [tokens, setTokens] = useState<MemberTokenMetadata[]>([]);
  const [name, setName] = useState("");
  const [client, setClient] = useState<"claude" | "codex">("claude");
  const [issued, setIssued] = useState<{ token: string; id: string; expiresAt: string } | null>(null);
  const [showIssued, setShowIssued] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = safeProfileName(projectId);
  const setup = clientSetupCommands(window.location.origin, profile, client);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await agentContextApi.tokens();
      setTokens(result.items.filter((token) => token.projectIds.includes(projectId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setError(null);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // load() updates state only after its API request settles.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canManage) void load(); }, [load, canManage]);

  async function issue(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const result = await agentContextApi.issueToken({ name: name.trim() || `Coding agent · ${projectId}`, projectIds: [projectId], expiresAt });
      setIssued({ token: result.token, id: result.metadata.id, expiresAt: result.metadata.expiresAt });
      setShowIssued(false);
      setName("");
      await load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(tokenId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await agentContextApi.revokeToken(tokenId);
      if (issued?.id === tokenId) { setIssued(null); setShowIssued(false); }
      toast.success("Coding Agent Workflow token revoked");
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
          <h2 id="member-token-heading" className="text-[15px] font-medium text-text">Connect your AI</h2>
          <p className="mt-0.5 max-w-2xl text-[12px] text-text-muted">Issue a project-scoped read token for the local CLI and MCP bridge. The portal uses your signed-in session for previews.</p>
        </div>
        {canManage ? <Button size="icon" variant="ghost" aria-label="Refresh Coding Agent Workflow tokens" onClick={() => { setLoading(true); void load(); }}><RefreshCw className="size-4" /></Button> : null}
      </div>
      {canManage && canRead ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Token name" className="min-w-56 flex-1">
            <Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder={`Coding agent · ${projectId}`} />
          </Field>
          <Button variant="solid" disabled={busy} onClick={() => void issue()}><KeyRound className="size-4" />{busy ? "Issuing…" : "Create 7-day token"}</Button>
        </div>
      ) : canManage ? <p className="text-[12px] text-text-muted">Your account can manage tokens, but <code>member.read</code> is required to issue one.</p> : <p className="text-[12px] text-text-muted">You need <code>tokens.manage-own</code> to view or revoke personal tokens.</p>}
      {issued !== null ? (
        <div role="status" className="shadow-border rounded-lg bg-recessed p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[13px] font-medium text-text">Copy this token now</p>
              <p className="mt-0.5 text-[12px] text-text-secondary">It is shown once and expires {formatDateTime(issued.expiresAt)}. Enter it at the CLI&apos;s hidden prompt; never put it in a command, URL, plugin config or chat.</p>
            </div>
            <Button size="small" variant="ghost" onClick={() => { setIssued(null); setShowIssued(false); }}>Close</Button>
          </div>
          <div className="mt-2 flex gap-2">
            <Input aria-label="New Coding Agent Workflow token" type={showIssued ? "text" : "password"} readOnly value={issued.token} autoComplete="new-password" />
            <Button size="small" variant="ghost" aria-label={showIssued ? "Hide token" : "Show token"} onClick={() => setShowIssued((shown) => !shown)}>{showIssued ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button>
            <Button size="small" variant="ghost" onClick={() => void copy(issued.token, "Token")}><Copy className="size-4" />Copy token</Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Client" className="w-40">
          <Select value={client} options={[{ value: "claude", label: "Claude Code" }, { value: "codex", label: "Codex CLI" }]} onChange={(value) => setClient(value as "claude" | "codex")} />
        </Field>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-text-muted">After creating the token, run the login command and paste it only into the hidden prompt.</p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-recessed px-2.5 py-2 font-mono text-[11px] leading-5 text-text">{setup}</pre>
        </div>
        <Button size="small" variant="ghost" onClick={() => void copy(setup, "Setup commands")}><Copy className="size-4" />Copy commands</Button>
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-text-muted"><Shield className="size-3.5" />The token is stored by the CLI in the operating system credential manager and can be revoked here.</p>
      {error === null ? null : <p role="alert" className="text-[12px] text-[var(--ds-status-red)]">{error}</p>}
      {!canManage ? null : loading ? <p className="text-[12px] text-text-muted">Loading tokens…</p> : tokens.length === 0 ? <EmptyState icon={KeyRound} title="No token for this project" description="Create one when you are ready to connect a local coding agent." className="py-3" /> : (
        <ul className="flex flex-col">
          {tokens.map((token, index) => {
            const inactive = token.revokedAt !== undefined;
            return <li key={token.id} className={`flex flex-wrap items-center gap-2 py-2 text-[12px] ${index > 0 ? "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]" : ""}`}>
              <span className="min-w-0 flex-1 font-medium text-text">{token.name}</span>
              <span className="text-text-muted">{inactive ? "Inactive" : "Expires"} {formatDateTime(token.expiresAt)}</span>
              {inactive ? <span className="text-text-muted">{token.revokedAt === undefined ? "Expired" : "Revoked"}</span> : <Button size="small" variant="danger" disabled={busy} onClick={() => void revoke(token.id)}><Trash2 className="size-3.5" />Revoke</Button>}
            </li>;
          })}
        </ul>
      )}
    </section>
  );
}

export function ProjectAccessPanel({ projectId, canManage }: { projectId: string; canManage: boolean }): React.JSX.Element | null {
  const toast = useToast();
  const [grants, setGrants] = useState<ProjectAccessGrant[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!canManage) return;
    try {
      const result = await agentContextApi.projectAccess(projectId);
      setGrants(result.items);
      const userList = await identityApi.users().catch(() => []);
      setUsers(userList.filter((user) => user.enabled));
      setError(null);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setLoading(false);
    }
  }, [projectId, canManage]);

  // load() updates state only after its API request settles.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canManage) void load(); }, [load, canManage]);
  if (!canManage) return null;

  async function grant(): Promise<void> {
    if (userId.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await agentContextApi.grantProjectAccess(projectId, userId.trim());
      toast.success("Project Access granted", userId.trim());
      setUserId("");
      await load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(target: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await agentContextApi.revokeProjectAccess(projectId, target);
      toast.success("Project Access revoked", target);
      await load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return <section aria-labelledby="project-access-heading" className="flex flex-col gap-3">
    <div>
      <h2 id="project-access-heading" className="text-[15px] font-medium text-text">Project Access</h2>
      <p className="mt-0.5 text-[12px] text-text-muted">Explicit access is checked on every task and document read. Assignment does not grant access.</p>
    </div>
    <div className="flex flex-wrap items-end gap-2">
      <Field label={users.length > 0 ? "Member" : "Member user ID"} className="min-w-56 flex-1">
        {users.length > 0 ? <Select value={userId} options={[{ value: "", label: "Choose a member" }, ...users.map((user) => ({ value: user.id, label: `${user.displayName} · ${user.username}` }))]} onChange={setUserId} /> : <Input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="User ID" />}
      </Field>
      <Button size="small" variant="solid" disabled={busy || userId.trim() === ""} onClick={() => void grant()}>Grant Project Access</Button>
      <Button size="icon" variant="ghost" aria-label="Refresh Project Access" onClick={() => { setLoading(true); void load(); }}><RefreshCw className="size-4" /></Button>
    </div>
    {error === null ? null : <p role="alert" className="text-[12px] text-[var(--ds-status-red)]">{error}</p>}
    {loading ? <p className="text-[12px] text-text-muted">Loading access grants…</p> : grants.length === 0 ? <EmptyState icon={Shield} title="No explicit grants" description="Only users with a grant and member.read can read Coding Agent Workflow context." className="py-3" /> : <ul className="flex flex-col">
      {grants.map((grant, index) => {
        const member = users.find((user) => user.id === grant.userId);
        return <li key={grant.userId} className={`flex flex-wrap items-center gap-2 py-2 text-[12px] ${index > 0 ? "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]" : ""}`}>
          <span className="min-w-0 flex-1 text-text">{member === undefined ? grant.userId : `${member.displayName} · ${member.username}`}</span>
          <span className="text-text-muted">Granted {formatDateTime(grant.grantedAt)}</span>
          <Button size="small" variant="danger" disabled={busy} onClick={() => void revoke(grant.userId)}><Trash2 className="size-3.5" />Revoke</Button>
        </li>;
      })}
    </ul>}
  </section>;
}
