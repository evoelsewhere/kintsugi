// Settings sections + navigation — macOS System-Settings style: a sidebar of icon
// rows on the left, the active section on the right. Adding a section: append to TABS.

import { Activity, Box, Cpu, GitBranch, type LucideIcon, Palette, Plug, Radio, Shield } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { AppearanceSection } from "./sections/appearance-section";
import { CodingAgentSecuritySection } from "./sections/coding-agent-security-section";
import { DiagnosticsSection } from "./sections/diagnostics-section";
import { GitSection } from "./sections/git-section";
import { McpServersSection } from "./sections/mcp-servers-section";
import { ProvidersSection } from "./sections/providers-section";
import { SandboxSection } from "./sections/sandbox-section";
import { TelemetryExportSection } from "./sections/telemetry-export-section";
import { SETTINGS_SECTION_PERMISSIONS as PERMISSION } from "./settings-access";

interface SettingsTab {
  id: string;
  label: string;
  icon: LucideIcon;
  /** `close` closes the Settings dialog, for a section that links to a page. */
  component: (props: { close: () => void }) => React.JSX.Element;
  /** Permission code the API requires for this section; hidden without it. */
  permission?: string;
}

const TABS: SettingsTab[] = [
  { id: "appearance", label: "Appearance", icon: Palette, component: () => <AppearanceSection /> },
  { id: "providers", label: "Providers", icon: Cpu, component: () => <ProvidersSection />, permission: PERMISSION.providers },
  { id: "mcp", label: "MCP servers", icon: Plug, component: () => <McpServersSection />, permission: PERMISSION.mcp },
  { id: "git", label: "Git", icon: GitBranch, component: () => <GitSection />, permission: PERMISSION.git },
  { id: "sandbox", label: "Sandbox & Agent", icon: Box, component: () => <SandboxSection />, permission: PERMISSION.sandbox },
  { id: "telemetry-export", label: "Telemetry export", icon: Radio, component: () => <TelemetryExportSection />, permission: PERMISSION.telemetryExport },
  { id: "security", label: "Security", icon: Shield, component: () => <CodingAgentSecuritySection />, permission: PERMISSION.security },
  { id: "diagnostics", label: "Diagnostics", icon: Activity, component: ({ close }) => <DiagnosticsSection onNavigate={close} /> },
];

export function SettingsTabs({ initial = "appearance", onClose }: { initial?: string; onClose: () => void }): React.JSX.Element {
  const { can } = useAuth();
  const tabs = TABS.filter((tab) => tab.permission === undefined || can(tab.permission));
  const [active, setActive] = useState(initial);
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]!;
  const Section = current.component;

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* Sidebar navigation */}
      <nav
        aria-label="Settings sections"
        className="flex w-full shrink-0 gap-0.5 overflow-x-auto border-b border-transparent p-1 [box-shadow:0_1px_0_0_rgba(0,0,0,0.08)] md:w-56 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:border-r md:border-b-0 md:[box-shadow:1px_0_0_0_rgba(0,0,0,0.08)]"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              aria-label={tab.label}
              aria-current={tab.id === current.id ? "page" : undefined}
              onClick={() => setActive(tab.id)}
              className={cn(
                "flex h-9 w-auto shrink-0 items-center gap-2.5 rounded-[var(--geist-radius)] px-2.5 text-left text-[13px] text-text-secondary hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)] md:w-full",
                tab.id === current.id && "bg-hover font-medium text-text",
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Active section */}
      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
        <Section close={onClose} />
      </div>
    </div>
  );
}
