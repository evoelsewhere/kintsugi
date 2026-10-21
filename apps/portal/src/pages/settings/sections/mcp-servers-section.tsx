// MCP servers — the registry UI (Settings → MCP servers, ADR-0047). Servers are HTTP endpoints an
// agent opts into by naming them in its tools; header values are write-only. "Test" connects with
// the stored headers and lists the tools, saying which of them agents can use.

import { PlugZap, Plus, Settings2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusDot } from "@/components/ui/status-dot";
import { useToast } from "@/components/ui/toast";
import { mcpServersApi, type McpServerInput, type McpServerView, type McpTestResult } from "@/lib/api/mcp-servers";
import { cn } from "@/lib/utils";
import { McpServerFormDialog } from "./mcp-server-form-dialog";

export function McpServersSection(): React.JSX.Element {
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; server: McpServerView | null }>({ open: false, server: null });
  const [removeTarget, setRemoveTarget] = useState<McpServerView | null>(null);
  const [tests, setTests] = useState<Record<string, McpTestResult | "testing">>({});
  const toast = useToast();

  const load = useCallback(async (): Promise<void> => {
    try {
      setServers(await mcpServersApi.list());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(id: string, input: McpServerInput): Promise<void> {
    if (dialog.server === null) await mcpServersApi.create(id, input);
    else await mcpServersApi.replace(dialog.server.id, input);
    toast.success(dialog.server === null ? "MCP server added" : "MCP server saved", id);
    // A changed server invalidates an earlier test.
    setTests((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id)));
    await load();
  }

  async function remove(server: McpServerView): Promise<void> {
    await mcpServersApi.remove(server.id);
    toast.success(`Removed ${server.id}`);
    await load();
  }

  async function test(server: McpServerView): Promise<void> {
    setTests((previous) => ({ ...previous, [server.id]: "testing" }));
    try {
      const result = await mcpServersApi.test(server.id);
      setTests((previous) => ({ ...previous, [server.id]: result }));
    } catch (testError) {
      setTests((previous) => ({ ...previous, [server.id]: { ok: false, message: testError instanceof Error ? testError.message : String(testError), tools: [] } }));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-medium text-text">MCP servers</h2>
          <p className="mt-0.5 text-[12px] text-text-muted">HTTP servers the runtime may give to agents that name them in their tools (ADR-0047). Header values are encrypted at rest.</p>
        </div>
        <Button size="small" variant="solid" onClick={() => setDialog({ open: true, server: null })}>
          <Plus className="size-4" />
          Add server
        </Button>
      </div>

      {error === null ? null : <p className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}

      <Card className="overflow-hidden p-0">
        {servers.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-text-secondary">No MCP servers registered. Add one, then name it in an agent&apos;s tools (for example mcp__tracker__*) so its jobs can use it.</p>
        ) : (
          servers.map((server, index) => {
            const result = tests[server.id];
            return (
              <div key={server.id}>
                <div className={cn("flex items-center gap-3 px-4 py-2.5", index > 0 && "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]")}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] text-text">
                      {server.id} <span className="font-mono text-[12px] text-text-muted">{server.toolEntry}</span>
                    </p>
                    <p className="truncate text-[12px] text-text-muted" title={server.url}>
                      {server.description === undefined ? server.url : `${server.description} · ${server.url}`}
                    </p>
                  </div>
                  <span className="hidden shrink-0 items-center gap-1.5 text-[12px] text-text-secondary sm:inline-flex">
                    <StatusDot tone={server.headerNames.length > 0 ? "green" : "muted"} />
                    {server.headerNames.length === 0 ? "no headers" : `${server.headerNames.length} header${server.headerNames.length === 1 ? "" : "s"}`}
                  </span>
                  {server.enabled ? null : <span className="shrink-0 text-[12px] text-text-muted">disabled</span>}
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="small" variant="ghost" onClick={() => setDialog({ open: true, server })}>
                      <Settings2 className="size-4" />
                      Configure
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => void test(server)}>
                      <PlugZap className="size-4" />
                      Test
                    </Button>
                    <Button size="icon" variant="danger" aria-label={`Remove ${server.id}`} onClick={() => setRemoveTarget(server)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {result === undefined ? null : result === "testing" ? (
                  <p className="px-4 pb-3 text-[12px] text-text-muted">Connecting…</p>
                ) : (
                  <div className="px-4 pb-3">
                    <p className={cn("flex items-center gap-1.5 text-[12px]", result.ok ? "text-[var(--ds-status-green-dark)]" : "text-[var(--ds-status-red)]")}>
                      <StatusDot tone={result.ok ? "green" : "red"} className="size-2" />
                      {result.message}
                    </p>
                    {result.tools.length === 0 ? null : (
                      <ul className="mt-2 flex flex-col gap-1">
                        {result.tools.map((tool) => (
                          <li key={tool.name} className="flex items-baseline gap-2 text-[12px]">
                            <StatusDot tone={tool.allowed ? "green" : "orange"} className="size-2 shrink-0 translate-y-px" />
                            <span className="font-mono text-text">{tool.name}</span>
                            <span className="shrink-0 text-text-muted">{tool.readOnly ? "read-only" : tool.allowed ? "allowed by name" : "not allowed: add it under Also allow these tools"}</span>
                            {tool.description === undefined ? null : <span className="min-w-0 truncate text-text-muted" title={tool.description}>{tool.description}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </Card>

      <McpServerFormDialog open={dialog.open} server={dialog.server} existingIds={servers.map((entry) => entry.id)} onClose={() => setDialog({ open: false, server: null })} onSubmit={save} />
      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove MCP server?"
        description={removeTarget === null ? undefined : `Remove "${removeTarget.id}"?`}
        confirmLabel="Remove server"
        busyLabel="Removing…"
        onConfirm={() => (removeTarget === null ? Promise.resolve() : remove(removeTarget))}
        onClose={() => setRemoveTarget(null)}
      >
        Agents that name this server keep the entry in their tools, and their jobs fail to start until the server is registered again or the entry is removed.
      </ConfirmDialog>
    </div>
  );
}
