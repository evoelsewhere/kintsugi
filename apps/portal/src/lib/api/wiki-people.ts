// The people of a project's directory (`GET wiki/people?q=`): username and display name of those who have Project Access,
// at most twenty, never an email. Only a person with Project Access asks.

import { apiGet } from "../api";
import type { Person } from "../wiki-mentions";

export const wikiPeopleApi = {
  search: (projectId: string, q: string): Promise<Person[]> => apiGet(`/api/projects/${encodeURIComponent(projectId)}/wiki/people?${new URLSearchParams({ q }).toString()}`),
};
