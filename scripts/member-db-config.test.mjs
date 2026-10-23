import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { databaseUrlFromEnvironment } from "./member-db-config.mjs";

test("mandatory integrations require an explicit test URL and ignore .env", async () => {
  const folder = await mkdtemp(join(tmpdir(), "kintsugi-db-config-"));
  const envFile = join(folder, ".env");
  await writeFile(envFile, "DATABASE_URL=postgresql://fallback:secret@localhost/fallback\n");
  try {
    assert.throws(
      () => databaseUrlFromEnvironment({ KINTSUGI_REQUIRED_INTEGRATION: "1" }, envFile),
      /KINTSUGI_TEST_DATABASE_URL is required/,
    );
    assert.equal(
      databaseUrlFromEnvironment({ KINTSUGI_REQUIRED_INTEGRATION: "1", KINTSUGI_TEST_DATABASE_URL: "postgresql://test:secret@127.0.0.1/kintsugi_test" }, envFile),
      "postgresql://test:secret@127.0.0.1/kintsugi_test",
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("ordinary integration tests keep environment-over-.env precedence", async () => {
  const folder = await mkdtemp(join(tmpdir(), "kintsugi-db-config-"));
  const envFile = join(folder, ".env");
  await writeFile(envFile, "DATABASE_URL=postgresql://fallback:secret@localhost/fallback\n");
  try {
    assert.equal(databaseUrlFromEnvironment({}, envFile), "postgresql://fallback:secret@localhost/fallback");
    assert.equal(databaseUrlFromEnvironment({ DATABASE_URL: "postgresql://env:secret@localhost/env" }, envFile), "postgresql://env:secret@localhost/env");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
