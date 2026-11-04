// The people a comment can mention (COL-08, COL-10): a directory for the editor to suggest from, and the lookup of the
// names a text mentions. Both reach only people with Project Access on the project and show no email address; a name that
// is nobody's, or whose owner has no access, is simply not found, so a mention tells nothing about who exists.

import { Injectable } from "@nestjs/common";
import { mentionsOf, resolveMentions } from "@kintsugi/domain";
import { type WikiPerson, WikiPeople } from "../domain/wiki.ports.js";

/** The most people the directory answers. */
export const PEOPLE_LIMIT = 20;
/** The longest search text. */
export const PEOPLE_QUERY_MAX = 64;

@Injectable()
export class WikiPeopleService {
  constructor(private readonly people: WikiPeople) {}

  /** People of the project whose username or display name holds the text, for the editor's suggestions. */
  search(projectId: string, query: string): Promise<WikiPerson[]> {
    return this.people.search(projectId, query.slice(0, PEOPLE_QUERY_MAX), PEOPLE_LIMIT);
  }

  /** The ids of the people with Project Access that a text mentions, once each; the other names are dropped without a word. */
  async mentionedIds(projectId: string, text: string): Promise<string[]> {
    const names = mentionsOf(text);
    if (names.length === 0) return [];
    return resolveMentions(names, await this.people.byUsernames(projectId, names));
  }
}
