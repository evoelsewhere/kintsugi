// Project Access of one project: who may record its stage decisions. Grants are explicit; assignment does not give one.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Shield, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { identityApi, type UserRecord } from "@/lib/api/identity";
import { projectAccessApi, type ProjectAccessGrant } from "@/lib/api/project-access";
import { errorText, formatDateTime } from "@/lib/format";

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
      const result = await projectAccessApi.list(projectId);
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
      await projectAccessApi.grant(projectId, userId.trim());
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
      await projectAccessApi.revoke(projectId, target);
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
      <p className="mt-0.5 text-[12px] text-text-muted">A person needs explicit Project Access to record decisions on this project's stages. Assignment does not grant access.</p>
    </div>
    <div className="flex flex-wrap items-end gap-2">
      <Field label={users.length > 0 ? "Member" : "Member user ID"} className="min-w-56 flex-1">
        {users.length > 0 ? <Select value={userId} options={[{ value: "", label: "Choose a member" }, ...users.map((user) => ({ value: user.id, label: `${user.displayName} · ${user.username}` }))]} onChange={setUserId} /> : <Input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="User ID" />}
      </Field>
      <Button size="small" variant="solid" disabled={busy || userId.trim() === ""} onClick={() => void grant()}>Grant Project Access</Button>
      <Button size="icon" variant="ghost" aria-label="Refresh Project Access" onClick={() => { setLoading(true); void load(); }}><RefreshCw className="size-4" /></Button>
    </div>
    {error === null ? null : <p role="alert" className="text-[12px] text-[var(--ds-status-red)]">{error}</p>}
    {loading ? <p className="text-[12px] text-text-muted">Loading access grants…</p> : grants.length === 0 ? <EmptyState icon={Shield} title="No explicit grants" description="Only users with a grant can record stage decisions for this project." className="py-3" /> : <ul className="flex flex-col">
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
