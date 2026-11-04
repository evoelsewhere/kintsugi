// The people a comment may mention (P3-004, COL-08, COL-10): the directory route and the lookup of mentioned names, both
// limited to people with Project Access, enabled, and never showing an email address.

import { WikiPeopleService } from "#modules/delivery/wiki/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, memberClient, startTestApp, type Client, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface Person {
  id: string;
  username: string;
  displayName: string;
}

describe.skipIf(!hasDatabase)("people of a project for mentions (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let reader: Client;
  let stranger: Client;
  const ids: Record<string, string> = {};
  const people = (client: Client, query: string, project = "shop") => client.get<Person[]>(`/projects/${project}/wiki/people${query === "" ? "" : `?q=${encodeURIComponent(query)}`}`);

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('github', 'github', 'GitHub', 'https://github.example.invalid', 'none')");
    for (const id of ["shop-docs", "other-docs"]) {
      await app.db.query("insert into admin.git_repository (id, server_id, url) values ($1, 'github', $2)", [id, `https://github.example.invalid/org/${id}.git`]);
    }
    for (const [id, repository] of [["shop", "shop-docs"], ["other", "other-docs"]] as const) {
      expect((await admin.request("POST", "/admin/projects", { body: { id, name: id, documentRepositoryId: repository } })).status).toBe(201);
    }
    const seed = async (username: string, displayName: string, projects: string[]) => {
      const member = await memberClient(app, admin, username, ["user"], projects);
      ids[username] = member.id;
      await app.db.query("update core.app_user set display_name = $2, email = $3 where id = $1", [member.id, displayName, `${username}@example.invalid`]);
      return member.client;
    };
    reader = await seed("ada", "Ada Lovelace", ["shop"]);
    await seed("grace", "Grace Hopper", ["shop"]);
    await seed("adam", "", ["shop"]);
    await seed("cecil", "Cecil", ["shop"]);
    await seed("linus", "Linus Torvalds", ["other"]);
    await seed("gone", "Gone Person", ["shop"]);
    await seed("pt", "100% sure_thing", ["shop"]);
    await app.db.query("update core.app_user set enabled = false where id = $1", [ids["gone"]]);
    stranger = await seed("stranger", "Stray", []);
  }, 180_000);
  afterAll(async () => {
    await app?.close();
  });

  it("lists the people of the project by part of the username or the display name, case-insensitive, the ones that start with it first", async () => {
    expect((await people(reader, "ad")).body.data?.map((person) => person.username)).toEqual(["ada", "adam"]);
    // Names that start with the text come before names that only hold it (ada and grace hold "ce" in their display names).
    expect((await people(reader, "ce")).body.data?.map((person) => person.username)).toEqual(["cecil", "ada", "grace"]);
    expect((await people(reader, "HOPPER")).body.data).toEqual([{ id: ids["grace"], username: "grace", displayName: "Grace Hopper" }]);
    // A person without a display name shows the username; an empty text lists the first people by username.
    expect((await people(reader, "adam")).body.data).toEqual([{ id: ids["adam"], username: "adam", displayName: "adam" }]);
    expect((await people(reader, "")).body.data?.map((person) => person.username)).toEqual(["ada", "adam", "cecil", "grace", "pt"]);
  });

  it("takes % and _ in the text as themselves, not as a pattern", async () => {
    expect((await people(reader, "%")).body.data?.map((person) => person.username)).toEqual(["pt"]);
    expect((await people(reader, "_")).body.data?.map((person) => person.username)).toEqual(["pt"]);
    expect((await people(reader, "a_a")).body.data).toEqual([]);
  });

  it("leaves out people without Project Access, disabled people and email addresses", async () => {
    const everyone = await people(reader, "");
    expect(everyone.body.data?.map((person) => person.username)).not.toContain("linus");
    expect(everyone.body.data?.map((person) => person.username)).not.toContain("gone");
    expect(everyone.body.data?.map((person) => person.username)).not.toContain("stranger");
    expect(everyone.raw).not.toContain("example.invalid");
    expect(everyone.raw).not.toContain("email");
    // Searching by an email address finds nobody.
    expect((await people(reader, "grace@example")).body.data).toEqual([]);
  });

  it("answers at most 20 people", async () => {
    for (let n = 0; n < 22; n++) await memberClient(app, admin, `many${String(n).padStart(2, "0")}`, ["user"], ["shop"]);
    expect((await people(reader, "many")).body.data).toHaveLength(20);
  });

  it("needs Project Access on the project", async () => {
    expect((await people(stranger, "")).status).toBe(403);
    expect((await people(reader, "", "other")).status).toBe(403);
  });

  it("resolves the mentioned names to the people with access, and a name nobody has equals a name without access", async () => {
    const service = app.nest.get(WikiPeopleService, { strict: false });
    const text = "Please look @ada and @Grace, cc @linus @nobody-has-this @gone and mail ada@example.invalid; `@adam` is code";
    expect(await service.mentionedIds("shop", text)).toEqual([ids["ada"], ids["grace"]]);
    const unknown = await service.mentionedIds("shop", "@ada @nobody-has-this");
    const withoutAccess = await service.mentionedIds("shop", "@ada @linus");
    expect(withoutAccess).toEqual(unknown);
    expect(await service.mentionedIds("shop", "no mentions here")).toEqual([]);
  });
});
