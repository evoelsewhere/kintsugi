import { McpServer } from "@modelcontextprotocol/server";
import type { MemberPort } from "@kintsugi/harness-sdk";
import { registerMemberTools } from "./tool-map.js";

export function createMemberMcp(member: MemberPort): McpServer {
  const server = new McpServer(
    { name: "kintsugi", version: "0.1.0" },
    { instructions: "Use explicit project identifiers. All tools read except activity_record, which only adds a short monitoring note; Kintsugi authorization is enforced on every request." },
  );
  registerMemberTools(server, member);
  return server;
}
