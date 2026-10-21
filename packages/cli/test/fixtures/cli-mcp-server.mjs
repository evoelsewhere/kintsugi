import { readFile } from "node:fs/promises";
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
      profiles: { work: { id: "work", baseUrl } },
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
  async set() {},
  async delete() {},
};

process.exitCode = await runCli(["mcp", "serve", "--profile", "work"], deps);
