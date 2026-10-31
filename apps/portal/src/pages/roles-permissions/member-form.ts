// The checks of the Add member / Edit member form, the same the API applies (apps/api → admin/users, user.dto.ts):
// a username is a lowercase kebab-case identifier, a password has at least 8 characters.

import { IDENTIFIER_MAX_LENGTH, IDENTIFIER_PATTERN } from "@kintsugi/domain";

export const MIN_PASSWORD_LENGTH = 8;

/** What is wrong with a username, or undefined when it can be sent; an empty one is only incomplete. */
export function usernameProblem(username: string): string | undefined {
  if (username === "") return undefined;
  if (username.length > IDENTIFIER_MAX_LENGTH) return `At most ${IDENTIFIER_MAX_LENGTH} characters.`;
  if (!IDENTIFIER_PATTERN.test(username)) return "Use lowercase letters, digits and hyphens, starting with a letter or digit (for example jane-doe).";
  return undefined;
}

/** What is wrong with a password, or undefined; empty is allowed where it means "keep the current one". */
export function passwordProblem(password: string): string | undefined {
  if (password === "" || password.length >= MIN_PASSWORD_LENGTH) return undefined;
  return `At least ${MIN_PASSWORD_LENGTH} characters.`;
}
