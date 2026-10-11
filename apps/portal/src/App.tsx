import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { subscribeToSystemAppearance } from "./lib/appearance";
import { PanelShell } from "./layout/panel-shell";
import { ToastProvider } from "./components/ui/toast";
import { AuthProvider, useAuth } from "./lib/auth";
import { AdminPage } from "./pages/admin";
import { AgentPage } from "./pages/agents/agent-page";
import { AgentsPage } from "./pages/agents/agents-page";
import { DeliveryPage } from "./pages/delivery/delivery-page";
import { GovernancePage } from "./pages/governance";
import { LoginPage } from "./pages/login";
import { MonitoringPage } from "./pages/monitoring";
import { OverviewPage } from "./pages/overview";
import { MembersPermissionsPage } from "./pages/members-permissions";
import { ProjectDetailPage } from "./pages/projects/project-detail-page";
import { ProjectsPage } from "./pages/projects/projects-page";

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
          <Route
            element={
              <RequireAuth>
                <PanelShell />
              </RequireAuth>
            }
          >
            <Route index element={<OverviewPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="delivery" element={<DeliveryPage />} />
            {/* Former per-workstream placeholders. */}
            <Route path="delivery/:areaId" element={<Navigate to="/delivery" replace />} />
            <Route path="monitoring" element={<MonitoringPage />} />
            <Route path="governance" element={<GovernancePage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="agents/:name" element={<AgentPage />} />
            <Route path="members" element={<MembersPermissionsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
