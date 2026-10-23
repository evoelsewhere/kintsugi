// Wiring of the debug MCP server (ADR-0056). The module is imported by the root module only when the installation is a
// development one (KINTSUGI_DEBUG_MCP=1): without it the route does not exist.

import { Module } from "@nestjs/common";
import { AuthModule } from "#modules/core/auth/index.js";
import { DebugAccess } from "./application/debug-access.js";
import { debugTools } from "./application/debug-tools.js";
import { DebugStore, WorkspaceFiles } from "./domain/debug.js";
import { DiskWorkspaceFiles } from "./infrastructure/disk-workspace.js";
import { PgDebugStore } from "./infrastructure/pg-debug.store.js";
import { DEBUG_TOOLS, DebugMcpController } from "./interface/debug-mcp.controller.js";

/** system · debug: read-only tools over runs, job workspaces, logs, queues and the database. */
@Module({
  imports: [AuthModule],
  controllers: [DebugMcpController],
  providers: [
    DebugAccess,
    { provide: DebugStore, useClass: PgDebugStore },
    { provide: WorkspaceFiles, useClass: DiskWorkspaceFiles },
    { provide: DEBUG_TOOLS, useFactory: (store: DebugStore, files: WorkspaceFiles) => debugTools(store, files), inject: [DebugStore, WorkspaceFiles] },
  ],
})
export class DebugModule {}
