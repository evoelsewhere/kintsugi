// An @mention in a rendered text: a chip with the person's display name when the directory knows the username, the plain
// `@username` it was written as when not. A chip is only a name: it links nowhere and shows nothing else about the person.

import { AtSign } from "lucide-react";
import { useContext } from "react";
import { MentionDirectoryContext } from "./use-mentions";

export function MentionChip({ username, children }: { username: string; children: React.ReactNode }): React.JSX.Element {
  const directory = useContext(MentionDirectoryContext);
  const displayName = directory?.displayName(username);
  if (displayName === undefined) return <>{children}</>;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-recessed px-1.5 py-px text-[0.92em] text-text" title={`@${username}`} data-mention-chip={username}>
      <AtSign className="size-3 text-text-muted" strokeWidth={1.75} aria-hidden="true" />
      {displayName}
    </span>
  );
}
