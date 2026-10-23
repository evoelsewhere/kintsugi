import { readFile, writeFile } from "node:fs/promises";
import { createDefaultCliDeps, runCli } from "../../dist/cli.js";

const deps = createDefaultCliDeps();
const baseUrl = process.env.KINTSUGI_TEST_BASE_URL;
const tokenFile = process.env.KINTSUGI_TEST_TOKEN_FILE;
if (baseUrl === undefined || tokenFile === undefined) throw new Error("Test configuration is incomplete");

deps.profiles = {
  async load() {
    return {
      schemaVersion: "1",
      activeProfile: "work",
      profiles: { work: { id: "work", baseUrl, projectId: "shop" } },
    };
  },
  async save() {},
};
deps.credentials = {
  async get(profileId) {
    if (profileId !== "work") return undefined;
    try {
      const token = (await readFile(tokenFile, "utf8")).trim();
      return token || undefined;
    } catch {
      return undefined;
    }
  },
  async set(_profileId, value) { await writeFile(tokenFile, value); },
  async delete() {},
};

if (process.env.KINTSUGI_TEST_BROWSER_AUTH === "1") {
  deps.openBrowser = async (value) => {
    const authorization = new URL(value);
    const callback = new URL(authorization.searchParams.get("redirectUri"));
    callback.searchParams.set("state", authorization.searchParams.get("state"));
    callback.searchParams.set("code", "synthetic-code");
    const response = await fetch(callback);
    if (!response.ok) throw new Error("Synthetic callback failed");
  };
  deps.promptSecret = async () => { throw new Error("MCP must never prompt on stdin"); };
  deps.readStdin = async () => { throw new Error("MCP must never read stdin outside protocol"); };
}

process.exitCode = await runCli(["mcp", "serve", "--profile", "work"], deps);
