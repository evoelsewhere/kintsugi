// Failures in plain words (shared by the worker, which records them, and the API, which reports a provider test). A few
// failures arrive as the raw text of the library that met them, which tells a person little: the known ones are said
// plainly, with the original kept after it as the detail.

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
export const isKnownFailure = (text: string): boolean => KNOWN.some((known) => known.match.test(text) || text.includes(known.plain));
