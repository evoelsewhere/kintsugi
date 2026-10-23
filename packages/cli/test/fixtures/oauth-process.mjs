// Disposable synthetic keyring substitute for cross-process tests only.
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { OAuthSession } from "../../dist/oauth.js";
import { withCredentialLock } from "../../dist/oauth-lock.js";

const profile = { id: process.env.KINTSUGI_TEST_PROFILE_ID, baseUrl: process.env.KINTSUGI_TEST_BASE_URL, projectId: "shop" };
const file = process.env.KINTSUGI_TEST_CREDENTIAL_FILE;
const mode = process.env.KINTSUGI_TEST_MODE;
if (!profile.id || !profile.baseUrl || !file) throw new Error("Missing synthetic process configuration");
const send = (value) => process.send?.(value);
const credentials = {
  async get() { try { return await readFile(file, "utf8"); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } },
  async set(_id, value) { const temporary = `${file}.${process.pid}`; await writeFile(temporary, value); await rename(temporary, file); },
  async delete() { await rm(file, { force: true }); },
};
const session = new OAuthSession({
  credentials,
  fetch: globalThis.fetch,
  stderr: { write() {} },
  openBrowser: async () => { send({ event: "browser" }); },
  createOAuthCallback: async ({ state }) => ({
    redirectUri: "http://127.0.0.1:54321/oauth/callback",
    waitForCode: async () => { await new Promise((resolve) => setTimeout(resolve, 100)); return { code: "synthetic-code", state }; },
    close: async () => undefined,
  }),
});

process.once("message", async () => {
  try {
    if (mode === "hold") await withCredentialLock(profile.id, async () => { send({ event: "locked" }); await new Promise(() => undefined); });
    else if (mode === "login") await session.beginBrowserLogin(profile, "shop", true);
    else if (mode === "logout") await session.logout(profile);
    else await session.accessTokenFor(profile);
    send({ event: "done", success: true });
  } catch (error) { send({ event: "done", success: false, code: error.code }); }
  process.disconnect();
});
send({ event: "ready" });
