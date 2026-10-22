// Prompt-cache reuse across jobs of one agent (ADR-0048). pi-ai's faux provider simulates a cache
// keyed by session id that reuses the common prefix of two prompts, so this shows what the
// kernel's prompt order and stable session id buy: the second job finds the shared part cached.

import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { JobEvent } from "@kintsugi/runtime-sdk";
import { afterAll, describe, expect, it } from "vitest";
import { createAgentRuntime } from "../src/agent-runtime.js";
import { agent, createWorkspace, jobSpec, runJob } from "./helpers.js";

const first = createWorkspace();
const second = createWorkspace();
afterAll(() => {
  first.remove();
  second.remove();
});

const usageOf = (events: JobEvent[]): Extract<JobEvent, { type: "usage" }> => events.find((event): event is Extract<JobEvent, { type: "usage" }> => event.type === "usage")!;

describe("prompt cache across jobs", () => {
  it("lets a second job of the same agent read the shared part of the prompt from the cache", async () => {
    const faux = fauxProvider({ provider: "faux", models: [{ id: "m1" }] });
    const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
    modelRuntime.registerNativeProvider(faux.provider);
    await modelRuntime.setRuntimeApiKey("faux", "test-key");
    const runtime = createAgentRuntime({ mode: "pi", resolveModelRuntime: async () => modelRuntime });

    const shared = "A long, stable body of instructions. ".repeat(200);
    const definition = agent(["read", "ls"], { instructions: shared, skills: [{ name: "style", content: "Skill text. ".repeat(200) }] });

    faux.setResponses([fauxAssistantMessage("one")]);
    const one = usageOf((await runJob(runtime, jobSpec(first, definition))).events);
    faux.setResponses([fauxAssistantMessage("two")]);
    const two = usageOf((await runJob(runtime, jobSpec(second, definition))).events);

    // Job one wrote the prompt to the cache; job two, whose workspace paths differ, read all of
    // the shared instructions and skills from it and re-sent only what is specific to it.
    expect(one.cacheReadTokens).toBe(0);
    expect(one.cacheWriteTokens).toBeGreaterThan(0);
    const sharedTokens = Math.floor((shared.length + "Skill text. ".repeat(200).length) / 4);
    expect(two.cacheReadTokens).toBeGreaterThanOrEqual(sharedTokens);
    expect(two.inputTokens).toBeLessThan(sharedTokens / 4);
  });

  it("does not share a cache between agents that differ", async () => {
    const faux = fauxProvider({ provider: "faux", models: [{ id: "m1" }] });
    const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
    modelRuntime.registerNativeProvider(faux.provider);
    await modelRuntime.setRuntimeApiKey("faux", "test-key");
    const runtime = createAgentRuntime({ mode: "pi", resolveModelRuntime: async () => modelRuntime });

    faux.setResponses([fauxAssistantMessage("one")]);
    await runJob(runtime, jobSpec(first, agent(["read"], { instructions: "First agent. ".repeat(100) })));
    faux.setResponses([fauxAssistantMessage("two")]);
    const other = usageOf((await runJob(runtime, jobSpec(second, agent(["read"], { id: "other", instructions: "Second agent. ".repeat(100) })))).events);
    expect(other.cacheReadTokens).toBe(0);
  });
});
