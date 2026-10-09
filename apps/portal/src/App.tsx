import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { PanelShell } from "./layout/panel-shell";
import { AdminPage } from "./pages/admin";
import { DeliveryPage } from "./pages/delivery";
import { GovernancePage } from "./pages/governance";
import { MonitoringPage } from "./pages/monitoring";
import { OverviewPage } from "./pages/overview";

export function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PanelShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="delivery" element={<DeliveryPage />} />
          <Route path="monitoring" element={<MonitoringPage />} />
          <Route path="governance" element={<GovernancePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
