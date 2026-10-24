// `kintsugi activity hook`: the hook a plugin command declares (ADR-0072). When a turn ends, the client runs it and passes the
// session in JSON on stdin. It reads the session transcript the client keeps on this machine, counts what the plugin's command
// used (tokens, turns, time) and records it for the project's monitoring through the same bounded activity record as everything
// else. It sends numbers and names only, never what was said or written, and it never fails the session: a hook that cannot
// report stays silent.
//
// Claude Code declares the hook in the command's front matter, so it runs for that command only. Codex and Copilot run a hook
// for the whole plugin, in every session where it is enabled, so for them the hook first looks for the command in the
// transcript and says nothing when the member did not run it.

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { ACTIVITY_HARNESSES, type ActivityDetail, type ActivityHarness } from "@kintsugi/harness-sdk";
import type { CliDeps } from "../cli.js";
import { CliError } from "../profile.js";
import { apiFor, projectId, type CommandOptions } from "./shared.js";

/** What a command used. A client that does not keep a number leaves it out (Copilot keeps no input tokens per message). */
export interface RunSummary {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Tokens the command's sub-agents used, where the client reports them. */
  subagentTokens?: number;
  turns: number;
  durationSeconds: number;
  model?: string;
}

type Entry = Record<string, unknown> & { type?: string; timestamp?: string };

function parseLines(transcript: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of transcript.split("\n")) {
    if (line.trim() === "") continue;
    try { entries.push(JSON.parse(line) as Entry); } catch { /* A half-written last line is skipped. */ }
  }
  return entries;
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
const obj = (value: unknown): Record<string, unknown> => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const time = (entry: Entry): number => (entry.timestamp === undefined ? Number.NaN : Date.parse(entry.timestamp));

function seconds(entries: readonly Entry[]): number {
  const times = entries.map(time).filter((value) => !Number.isNaN(value));
  return times.length === 0 ? 0 : Math.max(0, Math.round((times[times.length - 1]! - times[0]!) / 1000));
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Claude Code: from the command's last invocation (the line holding `/<plugin>:<command>`), else the session start. One model message counts once, by its id. */
function claudeSummary(entries: readonly Entry[], plugin: string, command: string): RunSummary {
  let start = 0;
  entries.forEach((entry, index) => {
    const message = obj(entry["message"]);
    if (message["role"] === "user" && JSON.stringify(message["content"] ?? "").includes(`/${plugin}:${command}`)) start = index;
  });
  const messages = new Map<string, { input: number; output: number; read: number; created: number }>();
  let model: string | undefined;
  const after = entries.slice(start);
  after.forEach((entry, index) => {
    const message = obj(entry["message"]);
    const usage = obj(message["usage"]);
    if (message["role"] !== "assistant" || Object.keys(usage).length === 0) return;
    const id = typeof message["id"] === "string" ? message["id"] : `line-${start + index}`;
    const previous = messages.get(id);
    messages.set(id, {
      input: Math.max(previous?.input ?? 0, num(usage["input_tokens"])),
      output: Math.max(previous?.output ?? 0, num(usage["output_tokens"])),
      read: Math.max(previous?.read ?? 0, num(usage["cache_read_input_tokens"])),
      created: Math.max(previous?.created ?? 0, num(usage["cache_creation_input_tokens"])),
    });
    if (typeof message["model"] === "string" && message["model"] !== "") model = message["model"];
  });
  const total = { input: 0, output: 0, read: 0, created: 0 };
  for (const usage of messages.values()) { total.input += usage.input; total.output += usage.output; total.read += usage.read; total.created += usage.created; }
  return { inputTokens: total.input, outputTokens: total.output, cacheReadTokens: total.read, cacheCreationTokens: total.created, turns: messages.size, durationSeconds: seconds(after), ...(model === undefined ? {} : { model }) };
}

/** Codex: the rollout's `token_count` events carry cumulative totals, so the command's usage is the last total minus the one before its invocation. */
function codexSummary(entries: readonly Entry[], plugin: string, command: string): RunSummary | undefined {
  const mention = new RegExp(`(?:^|[\\s(])[$@/](?:${escape(plugin)}:)?${escape(command)}(?![\\w-])`);
  let start = -1;
  entries.forEach((entry, index) => {
    const payload = obj(entry["payload"]);
    if (entry.type === "event_msg" && payload["type"] === "user_message" && typeof payload["message"] === "string" && mention.test(payload["message"])) start = index;
  });
  if (start < 0) return undefined;
  const totalOf = (entry: Entry): Record<string, unknown> => obj(obj(obj(entry["payload"])["info"])["total_token_usage"]);
  const isCount = (entry: Entry): boolean => entry.type === "event_msg" && obj(entry["payload"])["type"] === "token_count" && Object.keys(totalOf(entry)).length > 0;
  const counts = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => isCount(entry));
  const before = counts.filter(({ index }) => index < start).at(-1);
  const inside = counts.filter(({ index }) => index >= start);
  const last = inside.at(-1);
  if (last === undefined) return { turns: 0, durationSeconds: seconds(entries.slice(start)) };
  const base = before === undefined ? {} : totalOf(before.entry);
  const now = totalOf(last.entry);
  const diff = (key: string): number => Math.max(0, num(now[key]) - num(base[key]));
  const cached = diff("cached_input_tokens");
  const model = entries.slice(start).filter((entry) => entry.type === "turn_context").map((entry) => obj(entry["payload"])["model"]).filter((value): value is string => typeof value === "string").at(-1);
  return {
    inputTokens: Math.max(0, diff("input_tokens") - cached),
    outputTokens: diff("output_tokens"),
    cacheReadTokens: cached,
    cacheCreationTokens: diff("cache_write_input_tokens"),
    turns: new Set(inside.map(({ entry }) => num(totalOf(entry)["total_tokens"]))).size,
    durationSeconds: seconds(entries.slice(start)),
    ...(model === undefined ? {} : { model }),
  };
}

/** Copilot: `assistant.message` keeps the output tokens of each reply and `subagent.completed` the total of a sub-agent; input and cache are only in the shutdown snapshot of the whole session. */
function copilotSummary(entries: readonly Entry[], plugin: string, command: string): RunSummary | undefined {
  const mention = new RegExp(`(?:^|[\\s(])/(?:${escape(plugin)}:)?${escape(command)}(?![\\w-])`);
  let start = -1;
  entries.forEach((entry, index) => {
    const data = obj(entry["data"]);
    if (entry.type === "user.message" && typeof data["content"] === "string" && mention.test(data["content"])) start = index;
  });
  if (start < 0) return undefined;
  const after = entries.slice(start);
  const replies = new Map<string, number>();
  let model: string | undefined;
  let subagentTokens = 0;
  after.forEach((entry, index) => {
    const data = obj(entry["data"]);
    if (entry.type === "assistant.message") {
      replies.set(typeof data["messageId"] === "string" ? data["messageId"] : `line-${index}`, num(data["outputTokens"]));
      if (typeof data["model"] === "string" && data["model"] !== "") model = data["model"];
    } else if (entry.type === "subagent.completed" || entry.type === "subagent.failed") subagentTokens += num(data["totalTokens"]);
  });
  return { outputTokens: [...replies.values()].reduce((sum, value) => sum + value, 0), ...(subagentTokens > 0 ? { subagentTokens } : {}), turns: replies.size, durationSeconds: seconds(after), ...(model === undefined ? {} : { model }) };
}

/**
 * What a plugin's command used, from the client's transcript (one JSON object per line). For Claude Code, whose hook belongs to
 * the command, a transcript that does not show the command still counts from the start. For Codex and Copilot the result is
 * undefined when the member did not run the command in this session.
 */
export function summarizeTranscript(transcript: string, plugin: string, command: string, harness: ActivityHarness = "claude-code"): RunSummary | undefined {
  const entries = parseLines(transcript);
  if (harness === "codex") return codexSummary(entries, plugin, command);
  if (harness === "copilot") return copilotSummary(entries, plugin, command);
  return claudeSummary(entries, plugin, command);
}

interface HookInput {
  session_id?: unknown;
  sessionId?: unknown;
  transcript_path?: unknown;
  transcriptPath?: unknown;
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** Codex may send no transcript path; its rollout is `sessions/<year>/<month>/<day>/rollout-<time>-<session id>.jsonl`. */
async function findFile(root: string, accept: (path: string) => boolean, depth: number): Promise<string | undefined> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return undefined; }
  for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
    const path = join(root, entry.name);
    if (entry.isFile() && accept(path)) return path;
    if (entry.isDirectory() && depth > 0) { const found = await findFile(path, accept, depth - 1); if (found !== undefined) return found; }
  }
  return undefined;
}

async function transcriptFor(deps: CliDeps, harness: ActivityHarness, input: HookInput): Promise<string | undefined> {
  const given = text(input.transcript_path) ?? text(input.transcriptPath);
  if (given !== undefined) return given;
  const session = text(input.session_id) ?? text(input.sessionId);
  if (session === undefined || !/^[A-Za-z0-9-]{8,80}$/.test(session)) return undefined;
  const home = deps.homeDir ?? homedir();
  if (harness === "codex") return findFile(join(deps.env["CODEX_HOME"] ?? join(home, ".codex"), "sessions"), (path) => path.endsWith(`-${session}.jsonl`), 4);
  if (harness === "copilot") return join(deps.env["COPILOT_HOME"] ?? join(home, ".copilot"), "session-state", session, "events.jsonl");
  return undefined;
}

export function registerActivityHookCommand(activity: Command, deps: CliDeps): void {
  activity.command("hook <event>")
    .description("Report what a plugin command used (the hook a command declares; event: start, stop or end)")
    .requiredOption("--plugin <name>", "The plugin the command belongs to")
    .requiredOption("--command <name>", "The command that ran")
    .option("--harness <client>", "The client the hook runs in: claude-code (default), codex or copilot")
    .option("--project <id>", "Project id")
    .action(async function(this: Command, event: string) {
      const options = this.optsWithGlobals() as CommandOptions & { plugin: string; command: string; harness?: string };
      try {
        const harness = options.harness ?? "claude-code";
        if (!(ACTIVITY_HARNESSES as readonly string[]).includes(harness)) throw new CliError("HARNESS_INVALID", "The client must be claude-code, codex or copilot");
        let input: HookInput = {};
        try { input = JSON.parse(await deps.readStdin()) as HookInput; } catch { /* The client sends JSON; anything else means there is nothing to read. */ }
        const path = await transcriptFor(deps, harness as ActivityHarness, input);
        const summary = path === undefined ? undefined : summarizeTranscript(await readFile(path, "utf8"), options.plugin, options.command, harness as ActivityHarness);
        if (summary === undefined || summary.turns === 0) return;
        const { client, profile } = await apiFor(deps, this);
        const session = text(input.session_id) ?? text(input.sessionId);
        const detail: ActivityDetail = {
          event,
          ...(summary.inputTokens === undefined ? {} : { inputTokens: summary.inputTokens }),
          ...(summary.outputTokens === undefined ? {} : { outputTokens: summary.outputTokens }),
          ...(summary.cacheReadTokens === undefined ? {} : { cacheReadTokens: summary.cacheReadTokens }),
          ...(summary.cacheCreationTokens === undefined ? {} : { cacheCreationTokens: summary.cacheCreationTokens }),
          ...(summary.subagentTokens === undefined ? {} : { subagentTokens: summary.subagentTokens }),
          turns: summary.turns,
          durationSeconds: summary.durationSeconds,
          ...(summary.model === undefined ? {} : { model: summary.model }),
          ...(session === undefined ? {} : { session: session.slice(0, 64) }),
        };
        await client.recordActivity({
          projectId: projectId(options, profile.projectId),
          kind: "command.run",
          pluginName: options.plugin,
          harness,
          summary: `${options.plugin}:${options.command}`,
          detail,
        });
      } catch (error) {
        // Never fail the session: say why on stderr, briefly, and succeed.
        deps.stderr.write(`kintsugi activity hook: not reported (${error instanceof Error ? error.message : "failed"})\n`);
      }
    });
}
