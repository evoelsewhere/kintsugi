// Panel shell: fixed sidebar + content column (max --geist-page-width).
// Owns the settings modal — the sidebar user card and the Settings nav entry open it.

import { useState } from "react";
import { Outlet } from "react-router-dom";
import { SettingsModal } from "../pages/settings/settings-modal";
import { Sidebar } from "./sidebar";

export function PanelShell(): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[var(--geist-page-width)] px-8 py-8">
          <Outlet />
        </div>
      </main>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
