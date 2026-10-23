import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { subscribeToSystemAppearance } from "./lib/appearance";
import { PanelShell } from "./layout/panel-shell";
import { ToastProvider } from "./components/ui/toast";
import { AuthProvider, useAuth } from "./lib/auth";
import { AdminPage } from "./pages/admin";
import { AgentPage } from "./pages/agents/agent-page";
import { AgentsPage } from "./pages/agents/agents-page";
import { SkillPage } from "./pages/agents/skill-page";
import { PluginPage } from "./pages/plugins/plugin-page";
import { PluginsPage } from "./pages/plugins/plugins-page";
import { DeliveryOverviewPage } from "./pages/delivery/delivery-overview-page";
import { DeliveryStagePage } from "./pages/delivery/delivery-stage-page";
import { GovernancePage } from "./pages/governance";
import { LoginPage } from "./pages/login";
import { CodingAgentAuthorizePage } from "./pages/coding-agent-authorize";
import { MonitoringPage } from "./pages/monitoring";
import { OverviewPage } from "./pages/overview";
import { MembersPermissionsPage } from "./pages/members-permissions";
import { ProjectDetailPage } from "./pages/projects/project-detail-page";
import { MemberTaskPage } from "./pages/agent-context/member-task";
import { ProjectsPage } from "./pages/projects/projects-page";
import { DeveloperDocumentsPage } from "./pages/developer-documents";

function RequireAuth({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-[13px] text-text-muted">Loading…</div>
    );
  }
  return user === null ? <Navigate to="/login" replace /> : <>{children}</>;
}

export function App(): React.JSX.Element {
  useEffect(() => subscribeToSystemAppearance(), []);

  return (
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/coding-agent/authorize" element={<CodingAgentAuthorizePage />} />
          <Route
            element={
              <RequireAuth>
                <PanelShell />
              </RequireAuth>
            }
          >
            <Route index element={<OverviewPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="delivery" element={<DeliveryOverviewPage />} />
            {/* One page per pipeline stage; unknown ids (former per-workstream paths) go back to the overview. */}
            <Route path="delivery/:stage" element={<DeliveryStagePage />} />
            <Route path="delivery/*" element={<Navigate to="/delivery" replace />} />
            <Route path="monitoring" element={<MonitoringPage />} />
            <Route path="governance" element={<GovernancePage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="developer" element={<DeveloperDocumentsPage />} />
            <Route path="coding-agent-workflow" element={<Navigate to="/developer#start" replace />} />
            <Route path="projects/:projectId/coding-agent" element={<MemberTaskPage />} />
            <Route path="projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="plugins" element={<PluginsPage />} />
            <Route path="plugins/builder" element={<AgentsPage />} />
            <Route path="plugins/builder/skills/:name" element={<SkillPage />} />
            <Route path="plugins/builder/:name" element={<AgentPage />} />
            <Route path="plugins/:name" element={<PluginPage />} />
            <Route path="agents/*" element={<Navigate to="/plugins/builder" replace />} />
            <Route path="members" element={<MembersPermissionsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
