// Panel shell: fixed sidebar + content column (max --geist-page-width).
// Owns the settings modal — the sidebar user card and the Settings nav entry open it,
// and pages can open it on a section through the outlet context (lib/shell.ts).

import { useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import type { ShellContext } from "../lib/shell";
import { SettingsModal } from "../pages/settings/settings-modal";
import { Sidebar } from "./sidebar";

export function PanelShell(): React.JSX.Element {
  const [settings, setSettings] = useState<{ open: boolean; tab?: string; onClose?: () => void }>({ open: false });
  const context = useMemo<ShellContext>(
    () => ({ openSettings: (tab, onClose) => setSettings({ open: true, ...(tab === undefined ? {} : { tab }), ...(onClose === undefined ? {} : { onClose }) }) }),
    [],
  );

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar onOpenSettings={() => setSettings({ open: true })} />
      <main className="min-w-0 flex-1">
        <div className="w-full px-4 py-4 sm:px-6 md:px-8 md:py-5">
          <Outlet context={context} />
        </div>
      </main>
      <SettingsModal
        open={settings.open}
        {...(settings.tab === undefined ? {} : { initialTab: settings.tab })}
        onClose={() => {
          settings.onClose?.();
          setSettings({ open: false });
        }}
      />
    </div>
  );
}
