// The activity hook in Codex and Copilot (ADR-0072): a hook that covers the whole plugin finds the command in the client's own
// transcript, counts from there, and says nothing when the command was not run. The shapes are those of real sessions.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { summarizeTranscript } from "../src/commands/activity-hook.js";
import { createState } from "./support/distribution.js";

const line = (value: unknown) => JSON.stringify(value);
const totals = (input: number, cached: number, output: number, total: number) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 1, total_tokens: total });
const count = (timestamp: string, usage: ReturnType<typeof totals>) => line({ timestamp, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage, model_context_window: 258400 } } });
const said = (timestamp: string, message: string) => line({ timestamp, type: "event_msg", payload: { type: "user_message", message } });

const CODEX = [
  line({ timestamp: "2026-10-24T10:00:00Z", type: "session_meta", payload: { id: "s" } }),
  said("2026-10-24T10:00:01Z", "something else first"),
  count("2026-10-24T10:00:05Z", totals(100, 60, 10, 110)),
  said("2026-10-24T10:10:00Z", "$modernize:build billing/tax shop"),
  line({ timestamp: "2026-10-24T10:10:01Z", type: "turn_context", payload: { model: "gpt-5.6-sol" } }),
  count("2026-10-24T10:10:30Z", totals(400, 300, 50, 450)),
  count("2026-10-24T10:12:00Z", totals(900, 700, 120, 1020)),
].join("\n");

const COPILOT = [
  line({ type: "session.start", timestamp: "2026-10-24T10:00:00Z", data: {} }),
  line({ type: "user.message", timestamp: "2026-10-24T10:00:01Z", data: { content: "hello" } }),
  line({ type: "assistant.message", timestamp: "2026-10-24T10:00:05Z", data: { messageId: "m0", model: "claude-sonnet-4.6", outputTokens: 999 } }),
  line({ type: "user.message", timestamp: "2026-10-24T10:10:00Z", data: { content: "/modernize:build billing/tax shop" } }),
  line({ type: "assistant.message", timestamp: "2026-10-24T10:10:20Z", data: { messageId: "m1", model: "claude-sonnet-4.6", outputTokens: 100 } }),
  line({ type: "assistant.message", timestamp: "2026-10-24T10:10:20Z", data: { messageId: "m1", model: "claude-sonnet-4.6", outputTokens: 100 } }),
  line({ type: "subagent.completed", timestamp: "2026-10-24T10:11:00Z", data: { totalTokens: 1000 } }),
  line({ type: "assistant.message", timestamp: "2026-10-24T10:12:00Z", data: { messageId: "m2", model: "gpt-5.6-sol", outputTokens: 50 } }),
].join("\n");

describe("what a command used, in each client", () => {
  it("reads Codex from the token counts: the last total minus the one before the command", () => {
    expect(summarizeTranscript(CODEX, "modernize", "build", "codex")).toEqual({
      inputTokens: 160, outputTokens: 110, cacheReadTokens: 640, cacheCreationTokens: 0, turns: 2, durationSeconds: 120 + 0, model: "gpt-5.6-sol",
    });
    // Another skill, or a session without the command, reports nothing.
    expect(summarizeTranscript(CODEX, "modernize", "design", "codex")).toBeUndefined();
    expect(summarizeTranscript(CODEX.replace("$modernize:build", "build the thing"), "modernize", "build", "codex")).toBeUndefined();
  });

  it("reads Copilot from its replies and sub-agents; it keeps no input tokens per message", () => {
    expect(summarizeTranscript(COPILOT, "modernize", "build", "copilot")).toEqual({
      outputTokens: 150, subagentTokens: 1000, turns: 2, durationSeconds: 120, model: "gpt-5.6-sol",
    });
    expect(summarizeTranscript(COPILOT, "modernize", "design", "copilot")).toBeUndefined();
  });
});

describe("kintsugi activity hook --harness", () => {
  async function hook(harness: string, transcript: string, stdinOf: (path: string) => unknown) {
    const state = await createState({ "/api/member/v1/activity": { schemaVersion: "1", id: "act-1" } });
    const path = join(state.root, "session.jsonl");
    await writeFile(path, transcript);
    const bodies: string[] = [];
    const original = state.deps.fetch;
    state.deps.fetch = async (input, init) => { bodies.push(String(init?.body ?? "")); return original(input, init); };
    state.deps.readStdin = async () => JSON.stringify(stdinOf(path));
    const code = await runCli(["activity", "hook", "stop", "--plugin", "modernize", "--command", "build", "--harness", harness, "--token-stdin"], state.deps);
    return { code, bodies, stderr: state.stderr.join("") };
  }

  it("records Codex under its own name, from the transcript path the hook is given", async () => {
    const { code, bodies, stderr } = await hook("codex", CODEX, (path) => ({ session_id: "019a-aaaa-bbbb", transcript_path: path, hook_event_name: "Stop" }));
    expect(code, stderr).toBe(0);
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]!)).toMatchObject({ kind: "command.run", harness: "codex", pluginName: "modernize", summary: "modernize:build", detail: { inputTokens: 160, cacheReadTokens: 640, outputTokens: 110, turns: 2, model: "gpt-5.6-sol" } });
  });

  it("records Copilot from its camelCase input, without input tokens it does not have", async () => {
    const { code, bodies } = await hook("copilot", COPILOT, (path) => ({ sessionId: "c0ffee00-1111", transcriptPath: path, cwd: "/work" }));
    expect(code).toBe(0);
    const body = JSON.parse(bodies[0]!) as { harness: string; detail: Record<string, unknown> };
    expect(body.harness).toBe("copilot");
    expect(body.detail).toMatchObject({ outputTokens: 150, subagentTokens: 1000, turns: 2 });
    expect(body.detail).not.toHaveProperty("inputTokens");
  });

  it("says nothing when the plugin's command was not run in the session, and refuses an unknown client quietly", async () => {
    const quiet = await hook("codex", CODEX.replace("$modernize:build", "something"), (path) => ({ session_id: "019a-aaaa-bbbb", transcript_path: path }));
    expect(quiet.code).toBe(0);
    expect(quiet.bodies).toHaveLength(0);
    const unknown = await hook("emacs", CODEX, (path) => ({ transcript_path: path }));
    expect(unknown.code).toBe(0);
    expect(unknown.bodies).toHaveLength(0);
    expect(unknown.stderr).toContain("not reported");
  });
});
