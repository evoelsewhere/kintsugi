// Settings sections + navigation — macOS System-Settings style: a sidebar of icon
// rows on the left, the active section on the right. Adding a section: append to TABS.

import { Activity, Cpu, GitBranch, type LucideIcon, Palette, Settings, Shield } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { AppearanceSection } from "./sections/appearance-section";
import { DiagnosticsSection } from "./sections/diagnostics-section";
import { GitSection } from "./sections/git-section";
import { PlaceholderSection } from "./sections/placeholder-section";
import { ProvidersSection } from "./sections/providers-section";

interface SettingsTab {
  id: string;
  label: string;
  icon: LucideIcon;
  component: () => React.JSX.Element;
  /** Permission code the API requires for this section; hidden without it. */
  permission?: string;
}

const TABS: SettingsTab[] = [
  { id: "general", label: "General", icon: Settings, component: () => <PlaceholderSection title="General" description="Installation name, locale, default project settings and startup behavior." /> },
  { id: "appearance", label: "Appearance", icon: Palette, component: () => <AppearanceSection /> },
  { id: "providers", label: "Providers", icon: Cpu, component: () => <ProvidersSection />, permission: "providers.manage" },
  { id: "git", label: "Git", icon: GitBranch, component: () => <GitSection />, permission: "git.manage" },
  { id: "security", label: "Security", icon: Shield, component: () => <PlaceholderSection title="Security" description="Sessions, PAT lifetime, secret rotation and data-residency policy." /> },
  { id: "diagnostics", label: "Diagnostics", icon: Activity, component: () => <DiagnosticsSection /> },
];

export function SettingsTabs({ initial = "general" }: { initial?: string }): React.JSX.Element {
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
        className="flex w-full shrink-0 gap-0.5 overflow-x-auto border-b border-transparent p-1 [box-shadow:0_1px_0_0_rgba(0,0,0,0.08)] md:w-44 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:border-r md:border-b-0 md:[box-shadow:1px_0_0_0_rgba(0,0,0,0.08)]"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={cn(
                "flex h-8 w-auto shrink-0 items-center gap-2 rounded-[var(--geist-radius)] px-2 text-left text-[13px] text-text-secondary hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)] md:w-full",
                tab.id === active && "bg-hover font-medium text-text",
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Active section */}
      <div className="min-w-0 flex-1 overflow-y-auto px-3 py-2.5">
        <Section />
      </div>
    </div>
  );
}
