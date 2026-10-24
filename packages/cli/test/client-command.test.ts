import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runNativeClientCommand } from "../src/client-command.js";

function completedSpawn(exitCode: number) {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  queueMicrotask(() => {
    child.stdout.write("native output\n");
    child.stderr.write("native warning\n");
    child.emit("close", exitCode);
  });
  return child;
}

describe("runNativeClientCommand", () => {
  it("uses an allowlisted executable, argv arrays, and no shell on POSIX", async () => {
    const spawn = vi.fn(() => completedSpawn(0));
    const result = await runNativeClientCommand("claude", ["plugin", "install", "plugin id"], {
      platform: "linux",
      spawn,
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
    });

    expect(spawn).toHaveBeenCalledWith("claude", ["plugin", "install", "plugin id"], expect.objectContaining({ shell: false, stdio: ["inherit", "inherit", "inherit"] }));
    expect(result).toEqual({ exitCode: 0, stdout: "native output\n", stderr: "native warning\n" });
  });

  it("rejects arbitrary executable names and NUL arguments", async () => {
    const spawn = vi.fn(() => completedSpawn(0));
    const options = { platform: "linux" as const, spawn, stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
    await expect(runNativeClientCommand("cmd.exe", ["/c", "echo unsafe"], options)).rejects.toThrow(/Only Claude Code/);
    await expect(runNativeClientCommand("codex", ["bad\0argument"], options)).rejects.toThrow(/NUL/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("passes Windows arguments as JSON data to a static PowerShell launcher", async () => {
    const spawn = vi.fn((_command: string, _args: readonly string[], _options: unknown) => completedSpawn(0));
    const nativeArgs = ["plugin", "marketplace", "add", "C:\\Users\\Dev & Ops\\O'Brien (100%).json"];
    await runNativeClientCommand("claude", nativeArgs, {
      platform: "win32",
      spawn,
      env: { Path: "C:\\Windows\\System32", SystemRoot: "C:\\Windows" },
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
    });

    const [command, args, options] = spawn.mock.calls[0]!;
    expect(command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(args).toEqual(["-NoLogo", "-NoProfile", "-EncodedCommand", expect.any(String)]);
    const decoded = Buffer.from(args[3]!, "base64").toString("utf16le");
    expect(decoded).toContain("ConvertFrom-Json");
    // Each argument is its own element: PowerShell 5.1 would otherwise join them into one.
    expect(decoded).toContain("foreach ($argument in $parsedArgs)");
    expect(decoded).toContain("& $application.Source @nativeArgs");
    expect(decoded).not.toContain(nativeArgs[3]);
    expect((options as { shell: boolean }).shell).toBe(false);
    expect((options as { stdio: string[] }).stdio).toEqual(["inherit", "inherit", "inherit"]);
    expect((options as { env: NodeJS.ProcessEnv }).env.KINTSUGI_NATIVE_ARGS).toBe(JSON.stringify(nativeArgs));
    expect((options as { env: NodeJS.ProcessEnv }).env.KINTSUGI_NATIVE_EXECUTABLE).toBe("claude");
  });

  it("launches the Windows Codex executable directly so native argv stays separate", async () => {
    const spawn = vi.fn((_command: string, _args: readonly string[], _options: unknown) => completedSpawn(0));
    const nativeArgs = ["--no-daemon", "plugin", "marketplace", "add", "C:\\Users\\Dev & Ops\\O'Brien (100%).json"];
    await runNativeClientCommand("codex", nativeArgs, {
      platform: "win32",
      spawn,
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
    });

    expect(spawn).toHaveBeenCalledWith("codex", nativeArgs, expect.objectContaining({
      shell: false,
      stdio: ["inherit", "inherit", "inherit"],
    }));
  });
});
