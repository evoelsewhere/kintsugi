// Member plugins of one project: which member plugins the project offers and to whom (ADR-0069). A grant to
// everyone covers every member with Project Access; a grant to a member covers that member only.

import { useCallback, useEffect, useState } from "react";
import { Plug, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { identityApi, type UserRecord } from "@/lib/api/identity";
import { ALL_MEMBERS, pluginAccessApi, type PluginAccessGrant } from "@/lib/api/member-plugins";
import { type PluginSummary, pluginsApi } from "@/lib/api/plugins";
import { errorText } from "@/lib/format";

export function PluginAccessPanel({ projectId, canManage }: { projectId: string; canManage: boolean }): React.JSX.Element | null {
  const toast = useToast();
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [grants, setGrants] = useState<PluginAccessGrant[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [pluginName, setPluginName] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!canManage) return;
    try {
      const [catalog, access, userList] = await Promise.all([pluginsApi.list(), pluginAccessApi.list(projectId), identityApi.users().catch(() => [])]);
      setPlugins(catalog.filter((plugin) => plugin.audience === "member"));
      setGrants(access.items);
      setUsers(userList.filter((user) => user.enabled));
      setError(null);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setLoading(false);
    }
  }, [projectId, canManage]);

  // load() updates state only after its API requests settle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canManage) void load(); }, [load, canManage]);
  if (!canManage) return null;

  async function change(action: () => Promise<void>, message: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast.success(message);
      await load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (id: string): string => {
    const user = users.find((entry) => entry.id === id);
    return user === undefined ? id : `${user.displayName} · ${user.username}`;
  };

  return <section aria-labelledby="plugin-access-heading" className="flex flex-col gap-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="plugin-access-heading" className="text-[15px] font-medium text-text">Member plugins</h2>
        <p className="mt-0.5 max-w-2xl text-[12px] text-text-muted">Plugins the project's members can install into their own AI client with the Kintsugi CLI. A member also needs Project Access. Use is shown in Monitoring → Members.</p>
      </div>
      <Button size="icon" variant="ghost" aria-label="Refresh member plugins" onClick={() => { setLoading(true); void load(); }}><RefreshCw className="size-4" /></Button>
    </div>
    {error === null ? null : <p role="alert" className="text-[12px] text-[var(--ds-status-red)]">{error}</p>}
    {loading ? <p className="text-[12px] text-text-muted">Loading member plugins…</p> : plugins.length === 0 ? <EmptyState icon={Plug} title="No member plugins" description="No installed plugin is meant for members yet." className="py-3" /> : <>
      <ul className="flex flex-col">
        {plugins.map((plugin, index) => {
          const own = grants.filter((grant) => grant.pluginName === plugin.name);
          const everyone = own.some((grant) => grant.userId === ALL_MEMBERS);
          return <li key={plugin.name} className={`flex flex-col gap-1.5 py-2.5 text-[12px] ${index > 0 ? "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1"><span className="text-[13px] text-text">{plugin.title}</span> <span className="text-text-muted">{plugin.name} · {plugin.version}</span></span>
              {everyone
                ? <Button size="small" variant="ghost" disabled={busy} onClick={() => void change(() => pluginAccessApi.revoke(projectId, plugin.name, ALL_MEMBERS), "Withdrawn from all members")}>Withdraw from all members</Button>
                : <Button size="small" variant="solid" disabled={busy} onClick={() => void change(() => pluginAccessApi.grant(projectId, plugin.name, ALL_MEMBERS), "Offered to all members")}>Offer to all members</Button>}
            </div>
            {own.filter((grant) => grant.userId !== ALL_MEMBERS).map((grant) => <div key={grant.userId} className="flex items-center gap-2 pl-3">
              <span className="min-w-0 flex-1 text-text-secondary">{nameOf(grant.userId)}</span>
              <Button size="small" variant="danger" disabled={busy} onClick={() => void change(() => pluginAccessApi.revoke(projectId, plugin.name, grant.userId), "Access withdrawn")}><Trash2 className="size-3.5" />Revoke</Button>
            </div>)}
          </li>;
        })}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Plugin" className="w-56">
          <Select value={pluginName} options={[{ value: "", label: "Choose a plugin" }, ...plugins.map((plugin) => ({ value: plugin.name, label: plugin.title }))]} onChange={setPluginName} />
        </Field>
        <Field label="Member" className="min-w-56 flex-1">
          <Select value={userId} options={[{ value: "", label: "Choose a member" }, ...users.map((user) => ({ value: user.id, label: `${user.displayName} · ${user.username}` }))]} onChange={setUserId} />
        </Field>
        <Button size="small" variant="solid" disabled={busy || pluginName === "" || userId === ""} onClick={() => void change(async () => { await pluginAccessApi.grant(projectId, pluginName, userId); setUserId(""); }, "Offered to the member")}>Offer to one member</Button>
      </div>
    </>}
  </section>;
}
