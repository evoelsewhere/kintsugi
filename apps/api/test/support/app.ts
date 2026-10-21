// Boots the real AppModule exactly like src/main.ts, on a throwaway database and an
// ephemeral port, and gives tests a small cookie-aware HTTP client.

import "reflect-metadata";
import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { createTestDatabase, type TestDatabase } from "./database.js";

export const ADMIN_USER = "admin";
export const ADMIN_PASSWORD = `test-${randomBytes(6).toString("hex")}`;
const CSRF = { "x-kintsugi-csrf": "1" };

export interface TestApp {
  baseUrl: string;
  db: TestDatabase;
  /** The booted Nest application, for tests that call a provider directly. */
  nest: INestApplication;
  close(): Promise<void>;
}

export async function startTestApp(extraModules: import("@nestjs/common").Type[] = []): Promise<TestApp> {
  const db = await createTestDatabase();
  try {
    return await bootTestApp(db, extraModules, true);
  } catch (error) {
    await db.drop();
    throw error;
  }
}

/** Boots a fresh API process facade against an existing test database without dropping it on close. */
export async function startTestAppWithDatabase(
  db: TestDatabase,
  extraModules: import("@nestjs/common").Type[] = [],
): Promise<TestApp> {
  return bootTestApp(db, extraModules, false);
}

async function bootTestApp(
  db: TestDatabase,
  extraModules: import("@nestjs/common").Type[],
  dropDatabaseOnClose: boolean,
): Promise<TestApp> {
  // Configuration is read when modules load: set it before importing the app.
  process.env["DATABASE_URL"] = db.url;
  process.env["KINTSUGI_SECRET_KEY"] = randomBytes(32).toString("base64");
  process.env["KINTSUGI_BOOTSTRAP_ADMIN_USER"] = ADMIN_USER;
  process.env["KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD"] = ADMIN_PASSWORD;

  let app: INestApplication | undefined;
  try {
    const { Logger, Module, StandardSchemaValidationPipe } = await import("@nestjs/common");
    const { NestFactory } = await import("@nestjs/core");
    const { AppModule } = await import("../../src/app.module.js");
    @Module({ imports: [AppModule, ...extraModules] })
    class TestRootModule {}
    const { ensureSchema } = await import("#common/db/pool.js");
    const { HttpExceptionFilter } = await import("#common/filters/http-exception.filter.js");
    const { ResponseInterceptor } = await import("#common/interface/response.js");

    Logger.overrideLogger(false);
    const nest = await NestFactory.create<import("@nestjs/platform-express").NestExpressApplication>(TestRootModule, { logger: false, bodyParser: false });
    const { configureApiBodyParser } = await import("../../src/common/interface/body-parser.js");
    configureApiBodyParser(nest);
    app = nest;
    await ensureSchema();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalPipes(new StandardSchemaValidationPipe());
    await app.listen(0, "127.0.0.1");
  } catch (error) {
    await app?.close();
    const { closePool } = await import("#common/db/pool.js");
    await closePool();
    throw error;
  }

  const started = app;
  const address = started.getHttpServer().address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api`,
    db,
    nest: started,
    close: async () => {
      await started.close();
      const { closePool } = await import("#common/db/pool.js");
      await closePool();
      if (dropDatabaseOnClose) await db.drop();
    },
  };
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: { success: boolean; data?: T; message?: string | string[]; statusCode?: number };
  raw: string;
  headers: Headers;
}

/** An HTTP client holding one session cookie, like a browser tab. */
export class Client {
  cookie: string | undefined;

  constructor(private readonly app: TestApp) {}

  async request<T = unknown>(
    method: string,
    path: string,
    options: { body?: unknown; csrf?: boolean; headers?: Record<string, string> } = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.csrf ?? method !== "GET") Object.assign(headers, CSRF);
    if (this.cookie !== undefined) headers["cookie"] = this.cookie;
    const response = await fetch(`${this.app.baseUrl}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith("kintsugi_session="));
    if (setCookie !== undefined) {
      const pair = setCookie.split(";")[0]!;
      this.cookie = pair === "kintsugi_session=" ? undefined : pair;
    }
    const raw = await response.text();
    return { status: response.status, body: raw === "" ? { success: response.ok } : JSON.parse(raw), raw, headers: response.headers };
  }

  get<T = unknown>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>("GET", path);
  }

  async login(username: string, password: string): Promise<ApiResponse<{ user: { id: string; permissions: string[] } }>> {
    return this.request("POST", "/auth/login", { body: { username, password } });
  }
}

/** Signs in as the bootstrap admin. */
export async function adminClient(app: TestApp): Promise<Client> {
  const client = new Client(app);
  const response = await client.login(ADMIN_USER, ADMIN_PASSWORD);
  if (response.status !== 200) throw new Error(`admin login failed: ${response.raw}`);
  return client;
}

/** Creates a member with the given roles (as admin) and returns a signed-in client for them. */
export async function memberClient(app: TestApp, admin: Client, username: string, roleIds: string[]): Promise<{ client: Client; id: string; password: string }> {
  const password = `pw-${randomBytes(6).toString("hex")}`;
  const created = await admin.request<{ id: string }>("POST", "/admin/users", { body: { username, password, roleIds } });
  if (created.status !== 201) throw new Error(`create member failed: ${created.raw}`);
  const client = new Client(app);
  const login = await client.login(username, password);
  if (login.status !== 200) throw new Error(`member login failed: ${login.raw}`);
  return { client, id: created.body.data!.id, password };
}

/** Creates a sub-role holding exactly `permissions`. */
export async function subRole(admin: Client, id: string, permissions: string[]): Promise<void> {
  const created = await admin.request("POST", "/admin/roles", { body: { id, name: id } });
  if (created.status !== 201) throw new Error(`create role failed: ${created.raw}`);
  const set = await admin.request("PUT", `/admin/roles/${id}/permissions`, { body: { permissions } });
  if (set.status !== 200) throw new Error(`set permissions failed: ${set.raw}`);
}
