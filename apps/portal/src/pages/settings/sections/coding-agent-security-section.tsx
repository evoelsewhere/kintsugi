import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Shield, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { codingAgentSecurityApi, type CodingAgentConnectionLifetimeView } from "@/lib/api/coding-agent-security";
import { errorText, formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import {
  canManageCodingAgentSecurity,
  connectionRenewalExpired,
  codingAgentConnectionLifetimeOptions,
  connectionRenewalDeadline,
  type CodingAgentConnectionLifetime,
  type CodingAgentConnectionMetadata,
} from "./coding-agent-security-model";

export function CodingAgentSecuritySection(): React.JSX.Element {
  const { user } = useAuth();
  const toast = useToast();
  const [policy, setPolicy] = useState<CodingAgentConnectionLifetimeView | null>(null);
  const [connections, setConnections] = useState<CodingAgentConnectionMetadata[]>([]);
  const [draft, setDraft] = useState<CodingAgentConnectionLifetime>(15);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = canManageCodingAgentSecurity(user?.permissions ?? []);

  const load = useCallback(async (): Promise<void> => {
    if (!canManage) return;
    try {
      const [nextPolicy, nextConnections] = await Promise.all([
        codingAgentSecurityApi.lifetime(),
        codingAgentSecurityApi.connections(),
      ]);
      setPolicy(nextPolicy);
      setDraft(nextPolicy.maxAgeDays);
      setConnections(nextConnections.sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
      setError(null);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  // load() updates state only after both API reads settle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function savePolicy(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const updated = await codingAgentSecurityApi.setLifetime(draft);
      setPolicy(updated);
      setDraft(updated.maxAgeDays);
      toast.success("Connection age policy saved", `New and existing connections must renew within ${updated.maxAgeDays} days.`);
      await load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(connection: CodingAgentConnectionMetadata): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await codingAgentSecurityApi.revokeConnection(connection.id);
      toast.success("Coding Agent Workflow connection revoked", connection.clientName);
      await load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) return <p className="text-[12px] text-text-muted">The <code>security.manage</code> permission is required to manage installation connection policy.</p>;
  const activeCount = policy === null ? 0 : connections.filter((connection) => connection.revokedAt === undefined && !connectionRenewalExpired(connection.createdAt, policy.maxAgeDays)).length;

  return (
    <section aria-labelledby="coding-agent-security-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="coding-agent-security-heading" className="text-[15px] font-medium text-text">Coding Agent Workflow access</h2>
          <p className="mt-0.5 max-w-2xl text-[12px] text-text-muted">Set how long a member connection can renew, and revoke a connection before it reaches that limit.</p>
        </div>
        <Button size="icon" variant="ghost" aria-label="Refresh Coding Agent Workflow security" onClick={() => { setLoading(true); void load(); }}><RefreshCw className="size-4" /></Button>
      </div>

      <div className="rounded-lg bg-surface shadow-border">
        <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3 [box-shadow:inset_2px_0_0_0_var(--ds-accent)]">
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-medium text-text">Maximum connection age</h3>
            <p className="mt-0.5 text-[12px] text-text-muted">After this period, refresh is denied and the member must sign in again. Access tokens still last five minutes.</p>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
              <span>Renewal limit</span>
              <Select aria-label="Maximum coding agent connection age" value={String(draft)} options={codingAgentConnectionLifetimeOptions.map((option) => ({ value: String(option.value), label: option.label }))} onChange={(value) => setDraft(Number(value) as CodingAgentConnectionLifetime)} />
            </label>
            <Button size="small" variant="solid" disabled={busy || loading || policy?.maxAgeDays === draft} onClick={() => void savePolicy()}>{busy ? "Saving…" : "Save policy"}</Button>
          </div>
        </div>
        {policy === null ? null : <p className="px-3.5 pb-2.5 text-[11px] text-text-muted">{policy.isDefault ? "Default policy" : "Custom policy"}{policy.updatedAt === undefined ? "" : ` · Updated ${formatDateTime(policy.updatedAt)}`}</p>}
      </div>

      {error === null ? null : <p role="alert" className="text-[12px] text-[var(--ds-status-red)]">{error}</p>}
      <div className="overflow-hidden rounded-lg bg-surface shadow-border">
        <div className="flex items-center justify-between gap-2 bg-recessed/60 px-3.5 py-2 text-[11px] text-text-secondary">
          <span className="font-medium">Member connections</span>
          <span className="tabular-nums">{activeCount} active · {connections.length} total</span>
        </div>
        {loading ? <p className="px-3.5 py-3 text-[12px] text-text-muted">Loading connection metadata…</p> : connections.length === 0 ? (
          <div className="px-3.5 py-3"><EmptyState icon={Shield} title="No member connections" description="Connections appear after a member approves the project access request from their coding agent." className="py-2" /></div>
        ) : <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
          {connections.map((connection) => {
            const revoked = connection.revokedAt !== undefined;
            const deadline = policy === null ? undefined : connectionRenewalDeadline(connection.createdAt, policy.maxAgeDays);
            const expired = policy !== null && !revoked && connectionRenewalExpired(connection.createdAt, policy.maxAgeDays);
            return <li key={connection.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5 text-[12px]">
              <div className="min-w-48 flex-1">
                <p className="font-medium text-text">{connection.clientName} <span className="font-normal text-text-muted">· {connection.userId}</span></p>
                <p className="mt-0.5 text-[11px] text-text-muted">Projects: {connection.projectIds.map((id) => <code key={id} className="mr-1 rounded bg-recessed px-1 py-0.5 font-mono">{id}</code>)}</p>
              </div>
              <div className="text-[11px] text-text-muted">
                <p>Created <time dateTime={connection.createdAt} className="tabular-nums">{formatDateTime(connection.createdAt)}</time></p>
                <p>{connection.lastUsedAt === undefined ? "Not used yet" : `Last used ${formatDateTime(connection.lastUsedAt)}`}</p>
                {deadline === undefined ? null : <p>Renewal through {formatDateTime(deadline)}</p>}
              </div>
              <span className={revoked || expired ? "text-text-muted" : "text-[var(--ds-status-green)]"}>
                {revoked ? `Revoked ${formatDateTime(connection.revokedAt!)}` : expired ? "Expired · sign in again" : <><span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-[var(--ds-status-green)] align-middle" />Active</>}
              </span>
              {revoked ? null : <Button size="small" variant="danger" disabled={busy} onClick={() => void revoke(connection)}><Trash2 className="size-3.5" />Revoke</Button>}
            </li>;
          })}
        </ul>}
      </div>
    </section>
  );
}
