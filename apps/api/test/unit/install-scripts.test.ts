// The installers an installation serves: what they embed, how they quote, and that they parse.

import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderInstallPs1, renderInstallSh } from "../../src/modules/system/releases/application/install-scripts.js";
import { compareVersions, type ReleaseManifest } from "../../src/modules/system/releases/domain/release.js";

const sha = (char: string) => char.repeat(64);
const manifest: ReleaseManifest = {
  schemaVersion: "1",
  version: "0.1.0",
  builtAt: "2026-10-23T00:00:00.000Z",
  minNode: "22.19.0",
  assets: [
    { platform: "linux-x64", file: "kintsugi-0.1.0-linux-x64.tar.gz", sha256: sha("a"), size: 1 },
    { platform: "darwin-arm64", file: "kintsugi-0.1.0-darwin-arm64.tar.gz", sha256: sha("b"), size: 1 },
    { platform: "win32-x64", file: "kintsugi-0.1.0-win32-x64.tar.gz", sha256: sha("c"), size: 1 },
  ],
};

describe("install.sh", () => {
  const script = renderInstallSh({ baseUrl: "https://kintsugi.example", manifest });

  it("embeds the installation, the version and the hashes of the Linux and macOS packages only", () => {
    expect(script).toContain("BASE_URL='https://kintsugi.example'");
    expect(script).toContain("VERSION='0.1.0'");
    expect(script).toContain(`linux-x64) file='kintsugi-0.1.0-linux-x64.tar.gz'; sha256='${sha("a")}'`);
    expect(script).toContain(`darwin-arm64) file='kintsugi-0.1.0-darwin-arm64.tar.gz'; sha256='${sha("b")}'`);
    expect(script).not.toContain("win32");
  });

  it("records the installation it came from, so the CLI needs no URL", () => {
    expect(script).toContain("install.json");
    expect(renderInstallPs1({ baseUrl: "https://kintsugi.example", manifest })).toContain("install.json");
  });

  it("checks the download before it unpacks anything", () => {
    expect(script.indexOf("does not match its checksum")).toBeGreaterThan(0);
    expect(script.indexOf("does not match its checksum")).toBeLessThan(script.indexOf("tar -xzf"));
  });

  it("quotes a base URL that would break out of a string", () => {
    const hostile = renderInstallSh({ baseUrl: "http://localhost:8080/a'; touch /tmp/pwned; '", manifest });
    expect(hostile).toContain("BASE_URL='http://localhost:8080/a'\\''; touch /tmp/pwned; '\\'''");
  });

  const sh = spawnSync("sh", ["-c", "exit 0"]).status === 0;
  it.skipIf(!sh)("is valid POSIX shell", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kintsugi-sh-"));
    try {
      const path = join(directory, "install.sh");
      await writeFile(path, script, "utf8");
      const result = spawnSync("sh", ["-n", path], { encoding: "utf8" });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("install.ps1", () => {
  const script = renderInstallPs1({ baseUrl: "https://kintsugi.example", manifest });

  it("embeds the installation, the version and the hashes of the Windows packages only", () => {
    expect(script).toContain("$BaseUrl = 'https://kintsugi.example'");
    expect(script).toContain(`'win32-x64' = @{ File = 'kintsugi-0.1.0-win32-x64.tar.gz'; Sha256 = '${sha("c")}' }`);
    expect(script).not.toContain("linux-x64");
  });

  it("does not use the read-only $HOME variable for the install folder", () => {
    expect(script).not.toMatch(/\$home\b/i);
  });

  it("doubles single quotes in the base URL", () => {
    expect(renderInstallPs1({ baseUrl: "http://localhost:8080/a'b", manifest })).toContain("$BaseUrl = 'http://localhost:8080/a''b'");
  });

  const powershell = spawnSync("powershell", ["-NoProfile", "-Command", "exit 0"]).status === 0;
  it.skipIf(!powershell)("parses as PowerShell", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kintsugi-ps-"));
    try {
      const path = join(directory, "install.ps1");
      await writeFile(path, script, "utf8");
      const command = `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${path.replaceAll("'", "''")}', [ref]$null, [ref]$e); if ($e.Count -gt 0) { $e | ForEach-Object { $_.Message }; exit 1 }`;
      const result = spawnSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8" });
      expect(result.stdout).toBe("");
      expect(result.status).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("compareVersions", () => {
  it("orders numerically and puts a pre-release before its release", () => {
    expect(["0.10.0", "0.2.0", "1.0.0-rc.1", "1.0.0", "0.2.0-beta"].sort(compareVersions)).toEqual(["0.2.0-beta", "0.2.0", "0.10.0", "1.0.0-rc.1", "1.0.0"]);
  });
});
