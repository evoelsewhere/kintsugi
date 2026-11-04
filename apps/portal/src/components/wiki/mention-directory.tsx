// Loads the display names of the people a text mentions and hands them to the renderer inside it, so `@username` shows as a
// chip for a person of the project and stays plain text for anyone else. At most ten names per view are looked up, each by
// the directory's own search (an exact username match); a failed lookup leaves the name plain.

import { type ReactNode, useMemo } from "react";
import { MentionDirectoryContext } from "@/components/results/use-mentions";
import { wikiPeopleApi } from "@/lib/api/wiki-people";
import { useLoader } from "@/lib/use-loader";
import { wikiRead } from "@/lib/wiki";
import { mentionedNames } from "@/lib/wiki-mentions";

const MAX_LOOKUPS = 10;

export function MentionDirectory({ projectId, texts, children }: { projectId: string; texts: readonly string[]; children: ReactNode }): React.JSX.Element {
  const names = useMemo(() => [...new Set(texts.flatMap(mentionedNames))].slice(0, MAX_LOOKUPS), [texts]);
  const found = useLoader(`wiki/${projectId}/people/${names.join(",")}`, async () => {
    const map = new Map<string, string>();
    await Promise.all(
      names.map(async (name) => {
        try {
          const people = await wikiRead(() => wikiPeopleApi.search(projectId, name));
          const person = people.find((entry) => entry.username.toLowerCase() === name);
          if (person !== undefined) map.set(name, person.displayName === "" ? person.username : person.displayName);
        } catch {
          // The name stays plain text.
        }
      }),
    );
    return map;
  });
  const value = useMemo(() => ({ displayName: (username: string): string | undefined => found.data?.get(username.toLowerCase()) }), [found.data]);
  return <MentionDirectoryContext.Provider value={value}>{children}</MentionDirectoryContext.Provider>;
}
