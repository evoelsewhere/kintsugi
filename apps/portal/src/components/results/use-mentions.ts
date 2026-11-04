// The people a rendered text may mention as chips: the display name of a username of the project's directory. Without it
// (a view that has not loaded the directory) every `@name` stays the plain text it was written as.

import { createContext } from "react";

export interface MentionDirectory {
  /** The display name of a person of the project's directory, by lower-case username; undefined for a name nobody knows. */
  displayName: (username: string) => string | undefined;
}

export const MentionDirectoryContext = createContext<MentionDirectory | null>(null);
