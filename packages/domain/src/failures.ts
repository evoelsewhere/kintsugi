// Failures in plain words (shared by the worker, which records them, the API, which reports a provider test, and the
// portal, which shows them). A few failures arrive as the raw text of the library or the limit that met them, which
// tells a person little: the known ones are said plainly, with the original kept after it as the detail.

/** A known raw failure and what it means; `plain` words it from what `match` found when it names a figure. */
interface KnownFailure {
  match: RegExp;
  plain: string | ((found: RegExpExecArray) => string);
}

/** "45 s", "15 min", "1 h 30 min". */
function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

const usd = (value: string | undefined): string => `$${Number(value).toFixed(2)}`;

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
    // git says it either way: `Needed a single revision`, or `ambiguous argument 'HEAD': unknown revision`.
    match: /Needed a single revision|ambiguous argument 'HEAD': unknown revision/i,
    plain: "The repository has no commits yet. Push a first commit to its default branch, then sync it again.",
  },
  // The limits the runtime stops an agent job at (services/runtime/src/kernel/job.ts), as the worker records them
  // ("Agent <name> failed (<reason>): <message>") and as telemetry keeps them ("<reason>: <message>").
  {
    match: /max-turns\)?: stopped after (\d+) turn/,
    plain: (found) =>
      `The agent stopped at the turn limit of ${found[1]} turns per job before it finished; raise Turns per job in Settings → Sandbox & Agent, or narrow the task.`,
  },
  {
    // Not a stalled model ("timeout: stalled: …"): that one is the provider's, and the worker tries it once more.
    match: /timeout\)?: timed out after (\d+)\s*s/,
    plain: (found) =>
      `The agent stopped at the time limit of ${duration(Number(found[1]))} per job before it finished; raise Job timeout in Settings → Sandbox & Agent, or narrow the task.`,
  },
  {
    match: /budget\)?: cost (\d+(?:\.\d+)?) USD exceeded (\d+(?:\.\d+)?) USD/,
    plain: (found) =>
      `The agent stopped at the cost limit of ${usd(found[2])} per job after spending ${usd(found[1])}; raise Cost per job in Settings → Sandbox & Agent, or bind a cheaper model.`,
  },
  {
    match: /\(loop\): |^loop: /m,
    plain: "The model repeated itself, so the job was stopped; retry the run, or try another model or thinking level.",
  },
];

/** Where the original text starts in an explained failure. */
const DETAIL = " Detail: ";

/** The plain words of a known failure when `text` has it. */
function plainOf(known: KnownFailure, text: string): string | undefined {
  if (typeof known.plain === "string") return known.match.test(text) || text.includes(known.plain) ? known.plain : undefined;
  const found = known.match.exec(text);
  return found === null ? undefined : known.plain(found);
}

/** The failure said plainly when it is a known one, with the original as its detail; any other text as it is. */
export function explainFailure(text: string): string {
  for (const known of KNOWN) {
    const plain = plainOf(known, text);
    if (plain === undefined) continue;
    return text.includes(plain) ? text : `${plain}${DETAIL}${text}`;
  }
  return text;
}

/** Whether `text` is a failure this module explains (and so not a passing one). */
export const isKnownFailure = (text: string): boolean => KNOWN.some((known) => plainOf(known, text) !== undefined);

const STOP_REASON_LABEL: Record<string, string> = {
  completed: "Completed",
  error: "Error",
  "max-turns": "Turn limit",
  timeout: "Time limit",
  budget: "Cost limit",
  loop: "Repeated itself",
  "context-overflow": "Ran out of context",
  aborted: "Stopped",
};

/** How an agent job ended (`completed` or its `JobFailureReason`, as telemetry keeps it) in a word or two. */
export const stopReasonLabel = (reason: string): string => STOP_REASON_LABEL[reason] ?? reason;
