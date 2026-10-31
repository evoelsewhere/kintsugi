// The diagnostic tail of an agent step: the last tool calls and the start of what they returned, redacted.

import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_CALLS, ToolTail } from "../src/jobs/diagnostic.js";

describe("the diagnostic tail of an agent step", () => {
  it("keeps the last calls, oldest first, with what each returned", () => {
    const tail = new ToolTail();
    for (let n = 0; n < DIAGNOSTIC_CALLS + 5; n++) {
      tail.call(`c${n}`, "glob", `glob in "**/topology-${n}.py"`, false);
      tail.result(`c${n}`, true, "No files found matching pattern");
    }
    const lines = tail.lines();
    expect(lines).toHaveLength(DIAGNOSTIC_CALLS);
    expect(lines[0]).toBe('glob in "**/topology-5.py" → ok: No files found matching pattern');
    expect(lines.at(-1)).toContain("topology-24.py");
  });

  it("says when a call was blocked, failed or never returned, and never keeps the content of a file read", () => {
    const tail = new ToolTail();
    tail.call("a", "write", "write src/x.md", true);
    tail.call("b", "ls", "ls out", false);
    tail.result("b", false, "Path is outside the readable folders");
    tail.call("c", "read", "read as-is/app/main.c", false);
    tail.result("c", true, "int main(void) { return 0; }");
    tail.call("d", "grep", 'grep as-is "TODO"', false);
    expect(tail.lines()).toEqual([
      "write src/x.md → blocked",
      "ls out → error: Path is outside the readable folders",
      "read as-is/app/main.c → ok: file content (not kept)",
      'grep as-is "TODO" → no result (stopped while it ran)',
    ]);
  });

  it("redacts a credential in what a tool returned", () => {
    const tail = new ToolTail();
    tail.call("a", "shell", "shell env", false);
    tail.result("a", true, "API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789abcdefghij");
    expect(tail.lines()[0]).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });
});
