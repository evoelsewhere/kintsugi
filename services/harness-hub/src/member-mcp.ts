import { McpServer } from "@modelcontextprotocol/server";
import type { MemberPort } from "@kintsugi/harness-sdk";
import { registerMemberTools } from "./tool-map.js";

export function createMemberMcp(member: MemberPort): McpServer {
  const server = new McpServer(
    { name: "kintsugi", version: "0.1.0" },
    {
      instructions:
        "Use explicit project identifiers. All tools read except activity_record, which only adds a short monitoring note; Kintsugi authorization is enforced on every request. " +
        "To answer from the project's knowledge, reason over its Brain: brain_tree from the root, descend by the summaries, brain_read the nodes you chose and cite the numbered lines that hold the answer; " +
        "brain_lookup jumps to an id or path, brain_grep finds an exact term. Say so when the Brain does not hold the answer.",
    },
  );
  registerMemberTools(server, member);
  return server;
}
