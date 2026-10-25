import { useEffect, useState } from "react";
import { WEB_SEARCH_LIMITS, type WebSearchSettings } from "@kintsugi/domain";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { agentsApi, type AgentSummary } from "@/lib/api/agents";
import { webSearchApi } from "@/lib/api/web-search";
import { errorText } from "@/lib/format";

export function WebSearchPanel({ projectId }: { projectId: string }): React.JSX.Element {
  const [saved, setSaved] = useState<WebSearchSettings | null>(null);
  const [draft, setDraft] = useState<WebSearchSettings | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void Promise.all([webSearchApi.get(projectId), agentsApi.list()]).then(([settings, catalog]) => {
      if (!active) return;
      setSaved(settings); setDraft(settings);
      setAgents(catalog.filter((agent) => agent.audience === "runtime" && agent.enabled && agent.problems.length === 0));
    }).catch((failure: unknown) => { if (active) setError(errorText(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);
  async function save(): Promise<void> {
    if (draft === null) return;
    setBusy(true); setError(null);
    try { await webSearchApi.configure(projectId, draft); setSaved(draft); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  const changed = JSON.stringify(saved) !== JSON.stringify(draft);
  return <section aria-labelledby="web-search-heading" className="flex max-w-3xl flex-col gap-4">
    <div><h2 id="web-search-heading" className="text-[15px] font-medium">Web search</h2><p className="mt-1 text-[13px] text-text-secondary">Let selected runtime agents search public technical references with DuckDuckGo. No API key is needed. Agents decide when to search.</p></div>
    {error === null ? null : <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}
    {loading ? <p className="text-[13px] text-text-muted">Loading web search settings…</p> : draft === null ? <p className="text-[13px] text-text-muted">Settings could not be loaded.</p> : <>
      <Card className="flex flex-col gap-4 p-4">
        <Checkbox checked={draft.enabled} disabled={busy} onChange={(enabled) => setDraft({ ...draft, enabled })} label="Allow outbound web search" />
        <p className="text-[13px] text-text-secondary">Search queries are sent to DuckDuckGo. Agents are instructed to use public technical terms and keep source code, internal project details and credentials out of queries. Credential detection does not identify all confidential text.</p>
        <div className="border-t border-border pt-4"><h3 className="text-[14px] font-medium">Permitted agents</h3><p className="mt-1 text-[12px] text-text-muted">Select each agent explicitly. New agents receive no search access automatically.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{agents.map((agent) => <Checkbox key={agent.name} label={agent.name} checked={draft.agents.includes(agent.name)} disabled={busy} onChange={(checked) => setDraft({ ...draft, agents: checked ? [...draft.agents, agent.name] : draft.agents.filter((name) => name !== agent.name) })} />)}</div>
          {draft.agents.filter((name) => !agents.some((agent) => agent.name === name)).map((name) => <div key={name} className="mt-3 flex items-center gap-3 text-[12px] text-text-muted"><span>{name} · unavailable</span><Button size="small" variant="ghost" disabled={busy} onClick={() => setDraft({ ...draft, agents: draft.agents.filter((entry) => entry !== name) })}>Remove</Button></div>)}
        </div>
        <div className="flex items-center gap-3"><Button size="small" disabled={busy || !changed || (draft.enabled && draft.agents.length === 0)} onClick={() => void save()}>{busy ? "Saving…" : "Save settings"}</Button><span role="status" className="text-[12px] text-text-muted">{changed ? "Unsaved changes" : saved?.enabled ? "Web search enabled" : "Web search disabled"}</span></div>
      </Card>
      <p className="text-[12px] text-text-muted">Up to {WEB_SEARCH_LIMITS.results} results per query · {WEB_SEARCH_LIMITS.perStep} requests per step · {WEB_SEARCH_LIMITS.perRun} per run, including retries. Requests are serialized per project. DuckDuckGo may throttle or block automated requests; agents can continue without search.</p>
      <p className="text-[12px] text-text-muted">Results contain links and snippets. Full pages are not fetched or saved to project memory automatically. Disabling blocks subsequent calls and discards responses still in flight. Newly permitted agents receive the tool on their next execution.</p>
    </>}
  </section>;
}
