import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { WebSearchSettings } from "@kintsugi/domain";
import type { Actor } from "#common/auth/decorators.js";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import { AgentsService } from "#modules/admin/agents/index.js";
import { WebSearchRepository } from "../domain/web-search.repository.js";
@Injectable()
export class WebSearchService {
  constructor(private readonly repository: WebSearchRepository, private readonly agents: AgentsService, private readonly audit: AuditTrail) {}
  async view(projectId: string): Promise<WebSearchSettings> {
    const settings = await this.repository.view(projectId);
    if (settings === undefined) throw new NotFoundException("Project not found");
    return settings;
  }
  async configure(projectId: string, settings: WebSearchSettings, actor: Actor): Promise<void> {
    await this.view(projectId);
    const agents = [...new Set(settings.agents)];
    if (settings.enabled) {
      if (agents.length === 0) throw new BadRequestException("Select at least one runtime agent");
      for (const name of agents) {
        const definition = await this.agents.definition(name);
        if (definition.tools.length === 0) throw new BadRequestException(`Agent ${name} has no tool access`);
      }
    }
    await this.repository.configure(projectId, { enabled: settings.enabled, agents });
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.webSearchConfigure, { projectId, detail: { enabled: settings.enabled, agents } }));
  }
}
