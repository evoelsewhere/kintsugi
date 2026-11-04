// Watch and Unwatch on a page, a folder or a space of the wiki: a watched place tells the person in their inbox when its
// pages change, and when someone comments on it. A page watched through its folder or space says so, and is changed where
// it was set. Only the person's own watches are read or changed.

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { wikiWatchApi } from "@/lib/api/wiki-watch";
import { errorText } from "@/lib/format";
import { type WatchScope, watchAction, watchLabel, type WatchState } from "@/lib/notifications";
import { useLoader } from "@/lib/use-loader";
import { wikiRead } from "@/lib/wiki";

/** The button of a page: its state comes from the API, which also says what it is watched through. */
export function PageWatchButton({ projectId, path, target }: { projectId: string; path: string; target: string }): React.JSX.Element | null {
  const state = useLoader(`wiki/${projectId}/watch/${path}`, () =>
    wikiRead(() => wikiWatchApi.state(projectId, path)).catch((failure: unknown) => {
      // An API without the watch routes: no button.
      if ((failure as { status?: unknown }).status === 404) return null;
      throw failure;
    }),
  );
  if (state.data === undefined || state.data === null) return null;
  return <WatchControl projectId={projectId} scope="page" target={target} state={state.data} onChanged={() => void state.reload()} />;
}

/** The button of a folder or a space: it watches that place itself. */
export function PlaceWatchButton({ projectId, scope, target }: { projectId: string; scope: "folder" | "space"; target: string }): React.JSX.Element | null {
  const watches = useLoader(`wiki/${projectId}/watches`, () =>
    wikiRead(() => wikiWatchApi.list(projectId)).catch((failure: unknown) => {
      // An API without the watch routes: no button.
      if ((failure as { status?: unknown }).status === 404) return null;
      throw failure;
    }),
  );
  if (watches.data === undefined || watches.data === null) return null;
  const watching = watches.data.some((watch) => watch.scopeKind === scope && watch.target.toLowerCase() === target.toLowerCase());
  return <WatchControl projectId={projectId} scope={scope} target={target} state={{ direct: watching, via: null }} onChanged={() => void watches.reload()} label={scope} />;
}

function WatchControl({ projectId, scope, target, state, onChanged, label }: { projectId: string; scope: WatchScope; target: string; state: WatchState; onChanged: () => void; label?: string }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const action = watchAction(state);
  const click = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      if (action === "watch") await wikiWatchApi.watch(projectId, scope, target);
      else if (action === "unwatch") await wikiWatchApi.unwatch(projectId, scope, target);
      onChanged();
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Button size="small" disabled={busy || action === "none"} title={action === "none" ? "Change it where the watch was set" : undefined} onClick={() => void click()}>
        {state.direct ? <EyeOff /> : <Eye />}
        {label !== undefined && action === "watch" ? `Watch this ${label}` : label !== undefined && action === "unwatch" ? `Unwatch this ${label}` : watchLabel(state)}
      </Button>
      {failure === null ? null : (
        <span role="alert" className="text-[12px] text-[var(--ds-status-red)]">
          {failure}
        </span>
      )}
    </span>
  );
}
