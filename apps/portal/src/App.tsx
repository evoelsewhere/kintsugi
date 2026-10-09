import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { PanelShell } from "./layout/panel-shell";
import { AuthProvider, useAuth } from "./lib/auth";
import { AdminPage } from "./pages/admin";
import { DeliveryPage } from "./pages/delivery";
import { GovernancePage } from "./pages/governance";
import { LoginPage } from "./pages/login";
import { MonitoringPage } from "./pages/monitoring";
import { OverviewPage } from "./pages/overview";
import { MembersPermissionsPage } from "./pages/members-permissions";

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
  return (
    <AuthProvider>
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
            <Route path="monitoring" element={<MonitoringPage />} />
            <Route path="governance" element={<GovernancePage />} />
            <Route path="members" element={<MembersPermissionsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
