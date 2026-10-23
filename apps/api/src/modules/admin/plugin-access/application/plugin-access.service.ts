// Use cases of plugin access: who may use which member plugin in a project. Only plugins meant for
// members (audience "member") can be granted; runtime plugins run in the worker and need no grant.

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { PluginsService } from "#modules/admin/plugins/index.js";
import { ALL_MEMBERS, PluginAccessRepository, type PluginAccessGrant } from "../domain/plugin-access.repository.js";

@Injectable()
export class PluginAccessService {
  constructor(
    private readonly access: PluginAccessRepository,
    private readonly plugins: PluginsService,
    private readonly audit: AuditTrail,
  ) {}

  async list(projectId: string, actor: Actor): Promise<PluginAccessGrant[]> {
    this.#requireManagement(actor);
    if (!(await this.access.projectExists(projectId))) throw new NotFoundException("Project not found");
    return this.access.list(projectId);
  }

  async grant(projectId: string, pluginName: string, userId: string, actor: Actor): Promise<void> {
    this.#requireManagement(actor);
    await this.#requireMemberPlugin(pluginName);
    const [projectExists, userExists] = await Promise.all([
      this.access.projectExists(projectId),
      userId === ALL_MEMBERS ? Promise.resolve(true) : this.access.userExists(userId),
    ]);
    if (!projectExists || !userExists) throw new NotFoundException("Project or user not found");
    if (await this.access.grant(projectId, pluginName, userId, actor.id)) {
      await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.pluginAccessGrant, { projectId, subject: `${pluginName}:${userId}` }));
    }
  }

  async revoke(projectId: string, pluginName: string, userId: string, actor: Actor): Promise<void> {
    this.#requireManagement(actor);
    if (await this.access.revoke(projectId, pluginName, userId)) {
      await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.pluginAccessRevoke, { projectId, subject: `${pluginName}:${userId}` }));
    }
  }

  /** The member plugins a user may use in a project. */
  pluginsFor(userId: string, projectId: string): Promise<string[]> {
    return this.access.pluginsFor(userId, projectId);
  }

  async #requireMemberPlugin(name: string): Promise<void> {
    const plugin = await this.plugins.get(name);
    if (plugin.audience !== "member") throw new BadRequestException(`Plugin ${name} runs in the runtime; only member plugins are granted`);
  }

  #requireManagement(actor: Actor): void {
    if (!actor.permissions.includes("plugin.access.manage")) throw new ForbiddenException("Missing permission: plugin.access.manage");
  }
}
