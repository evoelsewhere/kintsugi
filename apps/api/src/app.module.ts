import { Module } from "@nestjs/common";
import { AgentsModule } from "./modules/admin/agents/agents.module.js";
import { ConnectorsModule } from "./modules/admin/connectors/connectors.module.js";
import { DocumentWritesModule } from "./modules/admin/document-writes/document-writes.module.js";
import { GitModule } from "./modules/admin/git/git.module.js";
import { InstallationSettingsModule } from "./modules/admin/settings/installation-settings.module.js";
import { HarnessesModule } from "./modules/admin/harnesses/harnesses.module.js";
import { LlmProvidersModule } from "./modules/admin/llm-providers/llm-providers.module.js";
import { ProjectBuildsModule } from "./modules/admin/project-build/project-builds.module.js";
import { ProjectsModule } from "./modules/admin/projects/projects.module.js";
import { RolesModule } from "./modules/admin/roles/roles.module.js";
import { TemplatesModule } from "./modules/admin/templates/templates.module.js";
import { UsersModule } from "./modules/admin/users/users.module.js";
import { AuthModule } from "./modules/core/auth/auth.module.js";
import { ArchitectureViewsModule } from "./modules/delivery/architecture/architecture-views.module.js";
import { CutoverChecklistsModule } from "./modules/delivery/cutover/cutover-checklists.module.js";
import { FactorySetupsModule } from "./modules/delivery/factory/factory-setups.module.js";
import { IncidentsModule } from "./modules/delivery/hypercare/incidents.module.js";
import { PortfolioItemsModule } from "./modules/delivery/portfolio/portfolio-items.module.js";
import { CatalogModule } from "./modules/delivery/catalog/catalog.module.js";
import { DocumentsModule } from "./modules/delivery/documents/documents.module.js";
import { RuntimeJobsModule } from "./modules/delivery/runtime-jobs/runtime-jobs.module.js";
import { VerificationRunsModule } from "./modules/delivery/verification/verification-runs.module.js";
import { WorkItemsModule } from "./modules/delivery/workbench/work-items.module.js";
import { AiMetricsModule } from "./modules/monitoring/ai-metrics/ai-metrics.module.js";
import { CostEntriesModule } from "./modules/monitoring/cost/cost-entries.module.js";
import { DashboardStatsModule } from "./modules/monitoring/dashboards/dashboard-stats.module.js";
import { JobRunsModule } from "./modules/monitoring/observability/job-runs.module.js";
import { OverviewModule } from "./modules/monitoring/overview/overview.module.js";
import { HealthChecksModule } from "./modules/monitoring/target-health/health-checks.module.js";
import { AuditEntriesModule } from "./modules/governance/audit/audit-entries.module.js";
import { GatesModule } from "./modules/governance/gates/gates.module.js";
import { PoliciesModule } from "./modules/governance/policies/policies.module.js";
import { ReviewsModule } from "./modules/governance/reviews/reviews.module.js";
import { RisksModule } from "./modules/governance/risks/risks.module.js";
import { HealthModule } from "./modules/system/health/health.module.js";

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
    // admin
    ProjectsModule,
    DocumentWritesModule,
    UsersModule,
    RolesModule,
    ConnectorsModule,
    GitModule,
    InstallationSettingsModule,
    LlmProvidersModule,
    AgentsModule,
    HarnessesModule,
    TemplatesModule,
    ProjectBuildsModule,
    // delivery
    PortfolioItemsModule,
    RuntimeJobsModule,
    DocumentsModule,
    CatalogModule,
    ArchitectureViewsModule,
    FactorySetupsModule,
    WorkItemsModule,
    VerificationRunsModule,
    CutoverChecklistsModule,
    IncidentsModule,
    // monitoring
    OverviewModule,
    JobRunsModule,
    DashboardStatsModule,
    AiMetricsModule,
    CostEntriesModule,
    HealthChecksModule,
    // governance
    PoliciesModule,
    GatesModule,
    ReviewsModule,
    AuditEntriesModule,
    RisksModule,
  ],
})
export class AppModule {}
