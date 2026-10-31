// Failures in plain words. A run, a step or a repository sync records why it failed; a few failures arrive as the raw
// text of the library that met them, which tells a person little. Those known ones are said plainly, with the
// original kept after it as the detail. And a few are the provider's, not the step's: worth one more try.

/** A known raw failure and what it means. */
interface KnownFailure {
  match: RegExp;
  plain: string;
}

const KNOWN: readonly KnownFailure[] = [
  {
    // Node's fetch refuses a header value outside Latin-1: a typographic quote or a non-ASCII character in an API key,
    // a base URL or a custom header of the model connection.
    match: /Cannot convert argument to a ByteString because the character at index \d+/i,
    plain:
      "The model connection has a character that cannot be sent in a request header, such as a typographic quote or a non-ASCII character in its API key, base URL or a custom header. Check the model connection in Settings and type the value again.",
  },
  {
    // git rev-parse of HEAD (or the default branch) in a mirror of a repository without any commit.
    match: /Needed a single revision/i,
    plain: "The repository has no commits yet. Push a first commit to its default branch, then sync it again.",
  },
];

/** Where the original text starts in an explained failure. */
const DETAIL = " Detail: ";

/** The failure said plainly when it is a known one, with the original as its detail; any other text as it is. */
export function explainFailure(text: string): string {
  for (const known of KNOWN) {
    if (text.includes(known.plain)) return text;
    if (known.match.test(text)) return `${known.plain}${DETAIL}${text}`;
  }
  return text;
}

/** Whether `text` is a failure this module explains (and so not a passing one). */
const isKnown = (text: string): boolean => KNOWN.some((known) => known.match.test(text) || text.includes(known.plain));

/**
 * Provider failures worth one more try of an agent step: a dropped or refused connection, a rate limit, an overload,
 * a server error, a stalled response or a content filter. A limit the job hit (timeout, turns, budget) and a known
 * failure of the settings are not.
 */
const TRANSIENT =
  /connection error|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|finish_reason|content_filter|provider|rate.?limit|overloaded|\b(429|50[0-4])\b|stalled/i;

export const isTransientFailure = (text: string): boolean => !isKnown(text) && TRANSIENT.test(text);
