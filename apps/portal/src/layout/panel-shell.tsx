// Panel shell: fixed sidebar + content column (max --geist-page-width).
// Owns the settings modal — the sidebar user card and the Settings nav entry open it,
// and pages can open it on a section through the outlet context (lib/shell.ts).

import { useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import { DetailHost } from "../components/detail-page";
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
      <a
        href="#content"
        className="sr-only rounded-[var(--geist-radius)] bg-surface px-3 py-2 text-[13px] text-text shadow-border focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
      >
        Skip to content
      </a>
      <Sidebar onOpenSettings={() => setSettings({ open: true })} />
      <main id="content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        <div className="w-full px-4 py-4 sm:px-5 md:px-5 md:py-5">
          <DetailHost>
            <Outlet context={context} />
          </DetailHost>
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
