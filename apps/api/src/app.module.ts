import { ProjectMemoryModule } from "./modules/admin/project-memory/project-memory.module.js";
import { Module } from "@nestjs/common";
import { debugMcpEnabled } from "./common/config/env.js";
import { AgentsModule } from "./modules/admin/agents/agents.module.js";
import { PluginAccessModule } from "./modules/admin/plugin-access/index.js";
import { PluginsModule } from "./modules/admin/plugins/plugins.module.js";
import { ConnectorsModule } from "./modules/admin/connectors/connectors.module.js";
import { DocumentWritesModule } from "./modules/admin/document-writes/document-writes.module.js";
import { GitModule } from "./modules/admin/git/git.module.js";
import { InstallationSettingsModule } from "./modules/admin/settings/installation-settings.module.js";
import { HarnessesModule } from "./modules/admin/harnesses/harnesses.module.js";
import { LlmProvidersModule } from "./modules/admin/llm-providers/llm-providers.module.js";
import { McpServersModule } from "./modules/admin/mcp-servers/mcp-servers.module.js";
import { ProjectBuildsModule } from "./modules/admin/project-build/project-builds.module.js";
import { ProjectsModule } from "./modules/admin/projects/projects.module.js";
import { RolesModule } from "./modules/admin/roles/roles.module.js";
import { TemplatesModule } from "./modules/admin/templates/templates.module.js";
import { UsersModule } from "./modules/admin/users/users.module.js";
import { AuthModule } from "./modules/core/auth/auth.module.js";
import { ArchitectureViewsModule } from "./modules/delivery/architecture/architecture-views.module.js";
import { FactorySetupsModule } from "./modules/delivery/factory/factory-setups.module.js";
import { CatalogModule } from "./modules/delivery/catalog/catalog.module.js";
import { BuildModule } from "./modules/delivery/build/build.module.js";
import { DesignModule } from "./modules/delivery/design/design.module.js";
import { DocumentsModule } from "./modules/delivery/documents/documents.module.js";
import { MemberApiModule } from "./modules/delivery/member-api/index.js";
import { RuntimeJobsModule } from "./modules/delivery/runtime-jobs/runtime-jobs.module.js";
import { WorkItemsModule } from "./modules/delivery/workbench/work-items.module.js";
import { AiMetricsModule } from "./modules/monitoring/ai-metrics/ai-metrics.module.js";
import { CostEntriesModule } from "./modules/monitoring/cost/cost-entries.module.js";
import { DashboardStatsModule } from "./modules/monitoring/dashboards/dashboard-stats.module.js";
import { SandboxModule } from "./modules/monitoring/sandbox/sandbox.module.js";
import { JobRunsModule } from "./modules/monitoring/observability/job-runs.module.js";
import { OverviewModule } from "./modules/monitoring/overview/overview.module.js";
import { PortfolioOverviewModule } from "./modules/monitoring/portfolio/portfolio.module.js";
import { MemberActivityModule } from "./modules/monitoring/member-activity/index.js";
import { TelemetryModule } from "./modules/monitoring/telemetry/telemetry.module.js";
import { HealthChecksModule } from "./modules/monitoring/target-health/health-checks.module.js";
import { AuditEntriesModule } from "./modules/governance/audit/audit-entries.module.js";
import { GatesModule } from "./modules/governance/gates/gates.module.js";
import { StageDecisionsModule } from "./modules/governance/stage-decisions/index.js";
import { PoliciesModule } from "./modules/governance/policies/policies.module.js";
import { ReviewsModule } from "./modules/governance/reviews/reviews.module.js";
import { RisksModule } from "./modules/governance/risks/risks.module.js";
import { RealtimeModule } from "./common/realtime/realtime.module.js";
import { EventsModule } from "./modules/system/events/events.module.js";
import { DebugModule } from "./modules/system/debug/debug.module.js";
import { HealthModule } from "./modules/system/health/health.module.js";
import { ReleasesModule } from "./modules/system/releases/index.js";

/**
 * Root module. Feature modules map one-to-one onto the functional areas of the
 * building block view (docs/architecture/05-building-block-view.md):
 * admin (A1–A7), delivery (B1–B7), monitoring (C1–C5), governance (D1–D6), system.
 */
@Module({
  imports: [
    // core: auth + identity
    AuthModule,
    // system
    HealthModule,
    ReleasesModule,
    RealtimeModule,
    EventsModule,
    // the debug MCP server exists only on a development installation (ADR-0056)
    ...(debugMcpEnabled() ? [DebugModule] : []),
    // admin
    ProjectsModule,
    ProjectMemoryModule,
    DocumentWritesModule,
    UsersModule,
    RolesModule,
    ConnectorsModule,
    GitModule,
    InstallationSettingsModule,
    LlmProvidersModule,
    McpServersModule,
    AgentsModule,
    PluginsModule,
    PluginAccessModule,
    HarnessesModule,
    TemplatesModule,
    ProjectBuildsModule,
    // delivery
    RuntimeJobsModule,
    DocumentsModule,
    MemberApiModule,
    CatalogModule,
    DesignModule,
    BuildModule,
    ArchitectureViewsModule,
    FactorySetupsModule,
    WorkItemsModule,
    // monitoring
    OverviewModule,
    PortfolioOverviewModule,
    TelemetryModule,
    MemberActivityModule,
    JobRunsModule,
    DashboardStatsModule,
    SandboxModule,
    AiMetricsModule,
    CostEntriesModule,
    HealthChecksModule,
    // governance
    PoliciesModule,
    GatesModule,
    StageDecisionsModule,
    ReviewsModule,
    AuditEntriesModule,
    RisksModule,
  ],
})
export class AppModule {}
