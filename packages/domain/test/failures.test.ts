import { describe, expect, it } from "vitest";
import { explainFailure, isKnownFailure, stopReasonLabel } from "../src/failures.js";

const TURNS = "Agent legacy-analyst failed (max-turns): stopped after 80 turn(s)";
const TIME = "Agent legacy-analyst failed (timeout): timed out after 2700s";
const COST = "Agent legacy-analyst failed (budget): cost 1.0312 USD exceeded 1 USD";
const LOOP = "Agent legacy-analyst failed (loop): stopped: glob was called with the same arguments 12 times";

describe("agent limits in plain words", () => {
  it("names the turn limit and where it is set, and keeps the original as the detail", () => {
    expect(explainFailure(TURNS)).toBe(
      `The agent stopped at the turn limit of 80 turns per job before it finished; raise Turns per job in Settings → Sandbox & Agent, or narrow the task. Detail: ${TURNS}`,
    );
  });

  it("names the time limit in minutes", () => {
    expect(explainFailure(TIME)).toBe(
      `The agent stopped at the time limit of 45 min per job before it finished; raise Job timeout in Settings → Sandbox & Agent, or narrow the task. Detail: ${TIME}`,
    );
  });

  it("names the cost limit and what the job spent", () => {
    expect(explainFailure(COST)).toBe(
      `The agent stopped at the cost limit of $1.00 per job after spending $1.03; raise Cost per job in Settings → Sandbox & Agent, or bind a cheaper model. Detail: ${COST}`,
    );
  });

  it("says a model that repeated itself is the model's, whatever repeated", () => {
    for (const text of [LOOP, "Agent a failed (loop): stopped: one turn produced 150k characters of thinking without a tool call"]) {
      expect(explainFailure(text)).toBe(`The model repeated itself, so the job was stopped; retry the run, or try another model or thinking level. Detail: ${text}`);
    }
  });

  it("reads a reason and its message on their own, as telemetry keeps them", () => {
    expect(explainFailure("max-turns: stopped after 80 turn(s)")).toMatch(/^The agent stopped at the turn limit of 80 turns per job/);
    expect(explainFailure("loop: stopped: glob was called with the same arguments 12 times")).toMatch(/^The model repeated itself/);
  });

  it("are known failures, explained once, also when a stage repeats the reason of its step", () => {
    for (const text of [TURNS, TIME, COST, LOOP]) {
      expect(isKnownFailure(text)).toBe(true);
      const step = explainFailure(text);
      expect(isKnownFailure(step)).toBe(true);
      expect(explainFailure(step)).toBe(step);
      const stage = explainFailure(`Step topology failed: ${step}`);
      expect(stage).toBe(`Step topology failed: ${step}`);
    }
  });

  it("leave a stalled model and any other text as they are", () => {
    for (const text of [
      "Agent x failed (timeout): stalled: no activity from the model for 300s (the provider stopped responding)",
      "Agent x failed (timeout): stalled for 600 s",
      "Step design failed: the verify loop: 2 rounds",
      "Agent x failed (error): boom",
    ]) {
      expect(explainFailure(text)).toBe(text);
      expect(isKnownFailure(text)).toBe(false);
    }
  });
});

describe("stopReasonLabel", () => {
  it("says how an agent job ended in a word or two", () => {
    expect(stopReasonLabel("completed")).toBe("Completed");
    expect(stopReasonLabel("max-turns")).toBe("Turn limit");
    expect(stopReasonLabel("timeout")).toBe("Time limit");
    expect(stopReasonLabel("budget")).toBe("Cost limit");
    expect(stopReasonLabel("loop")).toBe("Repeated itself");
    expect(stopReasonLabel("something-new")).toBe("something-new");
  });
});
