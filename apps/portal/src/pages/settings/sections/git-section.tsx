// Git — servers and repositories (Settings → Git, ADR-0025). Users register servers with
// one credential and the repositories Kintsugi should clone; the worker keeps a mirror
// of each in Kintsugi's own storage and reports its sync status here.

import { FolderGit2, Plus, Server, Settings2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { StatusDot, type StatusTone } from "../../../components/ui/status-dot";
import { gitApi, type GitRepositoryView, type GitServerInput, type GitServerView, type SyncStatus } from "../../../lib/api/git";
import { GitRepositoryDialog } from "./git-repository-dialog";
import { GitServerDialog } from "./git-server-dialog";

const AUTH_LABEL: Record<GitServerView["authType"], string> = { token: "access token", "ssh-key": "SSH key", none: "anonymous" };

const SYNC: Record<SyncStatus, { tone: StatusTone; label: string }> = {
  pending: { tone: "muted", label: "waiting for first clone" },
  cloning: { tone: "blue", label: "cloning" },
  ready: { tone: "green", label: "ready" },
  error: { tone: "red", label: "sync failed" },
};

type RemoveTarget = { kind: "server"; server: GitServerView } | { kind: "repository"; repository: GitRepositoryView };

export function GitSection(): React.JSX.Element {
  const [servers, setServers] = useState<GitServerView[]>([]);
  const [repositories, setRepositories] = useState<GitRepositoryView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [serverDialog, setServerDialog] = useState<{ open: boolean; server: GitServerView | null }>({ open: false, server: null });
  const [repositoryDialog, setRepositoryDialog] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [allServers, allRepositories] = await Promise.all([gitApi.listServers(), gitApi.listRepositories()]);
      setServers(allServers);
      setRepositories(allRepositories);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    // load() sets state only after awaiting the API, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function saveServer(id: string, input: GitServerInput): Promise<void> {
    if (serverDialog.server === null) await gitApi.createServer({ id, ...input });
    else await gitApi.replaceServer(id, input);
    await load();
  }

  async function remove(target: RemoveTarget): Promise<void> {
    if (target.kind === "server") await gitApi.removeServer(target.server.id);
    else await gitApi.removeRepository(target.repository.id);
    await load();
  }

  const serverName = (id: string): string => servers.find((server) => server.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-[15px] font-medium text-text">Git</h2>
        <p className="mt-0.5 text-[12px] text-text-muted">
          Servers and the repositories Kintsugi clones into its own storage (ADR-0025). Credentials are encrypted and only sent to their own server.
        </p>
      </div>

      {error === null ? null : <p className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}

      <Card className="overflow-hidden p-0">
        <CardHeader className="px-4 pt-3">
          <div>
            <CardTitle>Servers</CardTitle>
            <CardDescription>One credential per server: an access token, or an SSH key with pinned host keys.</CardDescription>
          </div>
          <Button size="small" variant="solid" onClick={() => setServerDialog({ open: true, server: null })}>
            <Plus className="size-4" />
            Add server
          </Button>
        </CardHeader>
        {servers.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-text-secondary">No Git servers yet — add one, then register its repositories.</p>
        ) : (
          servers.map((server) => (
            <div key={server.id} className="flex items-center gap-3 px-4 py-2.5 [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
              <Server className="size-5 shrink-0 text-text-secondary" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-text">{server.name}</p>
                <p className="truncate text-[12px] text-text-muted">
                  {server.id} · {server.baseUrl}
                </p>
              </div>
              <span className="hidden shrink-0 items-center gap-1.5 text-[12px] text-text-secondary sm:inline-flex">
                <StatusDot tone={server.authType === "none" || server.hasCredential ? "green" : "orange"} />
                {server.authType === "none" ? AUTH_LABEL.none : server.hasCredential ? `${AUTH_LABEL[server.authType]} stored` : `no ${AUTH_LABEL[server.authType]}`}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="small" variant="ghost" onClick={() => setServerDialog({ open: true, server })}>
                  <Settings2 className="size-4" />
                  Configure
                </Button>
                <Button size="icon" variant="danger" aria-label={`Remove ${server.id}`} onClick={() => setRemoveTarget({ kind: "server", server })}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader className="px-4 pt-3">
          <div>
            <CardTitle>Repositories</CardTitle>
            <CardDescription>Source, target and workspace repositories. Each must be reachable with its server's credential.</CardDescription>
          </div>
          <Button size="small" variant="solid" disabled={servers.length === 0} onClick={() => setRepositoryDialog(true)}>
            <Plus className="size-4" />
            Add repository
          </Button>
        </CardHeader>
        {repositories.length === 0 ? (
          <CardContent>
            <p className="py-2 text-center text-[13px] text-text-secondary">No repositories registered yet.</p>
          </CardContent>
        ) : (
          repositories.map((repository) => {
            const sync = SYNC[repository.syncStatus];
            return (
              <div key={repository.id} className="flex items-center gap-3 px-4 py-2.5 [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
                <FolderGit2 className="size-5 shrink-0 text-text-secondary" strokeWidth={1.5} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-text">{repository.id}</p>
                  <p className="truncate text-[12px] text-text-muted">
                    {serverName(repository.serverId)} · {repository.url}
                    {repository.defaultBranch === undefined ? "" : ` · ${repository.defaultBranch}`}
                  </p>
                </div>
                <span
                  className="hidden shrink-0 items-center gap-1.5 text-[12px] text-text-secondary sm:inline-flex"
                  title={repository.lastError ?? (repository.lastCommit === undefined ? undefined : `at ${repository.lastCommit.slice(0, 12)}`)}
                >
                  <StatusDot tone={sync.tone} />
                  {sync.label}
                </span>
                <Button size="icon" variant="danger" aria-label={`Remove ${repository.id}`} onClick={() => setRemoveTarget({ kind: "repository", repository })}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })
        )}
      </Card>

      <GitServerDialog
        open={serverDialog.open}
        server={serverDialog.server}
        existingIds={servers.map((server) => server.id)}
        onClose={() => setServerDialog({ open: false, server: null })}
        onSubmit={saveServer}
      />

      <GitRepositoryDialog
        open={repositoryDialog}
        servers={servers}
        existingIds={repositories.map((repository) => repository.id)}
        onClose={() => setRepositoryDialog(false)}
        onSubmit={async (input) => {
          await gitApi.createRepository(input);
          await load();
        }}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title={removeTarget?.kind === "server" ? "Remove Git server?" : "Remove repository?"}
        description={
          removeTarget === null ? undefined : removeTarget.kind === "server" ? `Remove "${removeTarget.server.name}" and its stored credential?` : `Remove "${removeTarget.repository.id}"?`
        }
        confirmLabel={removeTarget?.kind === "server" ? "Remove server" : "Remove repository"}
        busyLabel="Removing…"
        onConfirm={() => (removeTarget === null ? Promise.resolve() : remove(removeTarget))}
        onClose={() => setRemoveTarget(null)}
      >
        {removeTarget?.kind === "server"
          ? "The server must have no repositories. Its credential is deleted and cannot be recovered."
          : "Kintsugi stops syncing this repository. The repository on the Git server is not touched."}
      </ConfirmDialog>
    </div>
  );
}
