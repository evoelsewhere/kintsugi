// Shown when no Git repository is registered yet: projects pick their repositories from
// Settings -> Git, so point there (or to an admin when the user cannot manage Git).

import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useShell } from "@/lib/shell";

export function NoRepositories({ onSettingsClosed }: { onSettingsClosed: () => void }): React.JSX.Element {
  const { can } = useAuth();
  const { openSettings } = useShell();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--geist-radius)] bg-recessed px-3 py-2.5 text-[13px] text-text-secondary">
      <span className="min-w-0 flex-1">No Git repositories are registered yet. Projects link repositories registered in Settings → Git.</span>
      {can("git.manage") ? (
        <Button size="small" variant="ghost" onClick={() => openSettings("git", onSettingsClosed)}>
          <GitBranch className="size-4" />
          Open Settings → Git
        </Button>
      ) : (
        <span className="text-text-muted">Ask an administrator to register them.</span>
      )}
    </div>
  );
}
