// What the wiki shows for a project whose wiki is switched off: nothing is read, and a person with `wiki.manage` can
// turn it on. Turning it on puts the project's Brain on the default branch and builds it; the refusal of the API
// (a repository that is not mirrored yet, a Brain that cannot follow the default branch) is shown as the API words it.

import { BookText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { brainApi } from "@/lib/api/brain";
import { useAuth } from "@/lib/auth";
import { errorText } from "@/lib/format";
import { projectLink } from "@/lib/links";
import { WIKI_MANAGE } from "@/lib/wiki";

export function WikiOff({ projectId, onChanged }: { projectId: string; onChanged: () => void }): React.JSX.Element {
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const manage = can(WIKI_MANAGE);

  const turnOn = async (): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    try {
      await brainApi.setWiki(projectId, true);
      onChanged();
    } catch (failure) {
      setRefusal(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <EmptyState
        icon={BookText}
        title="The wiki is off"
        description={
          manage
            ? "Turn the wiki on to read this project's document repository as pages. Its Brain is built from the default branch and follows it."
            : "The wiki is off for this project, so nothing is shown here. A person with the permission to manage the wiki can turn it on."
        }
        action={
          <div className="flex flex-col items-center gap-2">
            {manage ? (
              <Button variant="solid" disabled={busy} onClick={() => void turnOn()}>
                {busy ? "Turning on…" : "Turn the wiki on"}
              </Button>
            ) : null}
            {refusal === null ? null : (
              <p role="alert" className="max-w-md text-center text-[13px] text-[var(--ds-status-red)]">
                {refusal}
              </p>
            )}
            <Link to={projectLink(projectId)} className="text-[13px] text-accent hover:underline">
              Open the project
            </Link>
          </div>
        }
      />
    </Card>
  );
}
