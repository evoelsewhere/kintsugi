// Settings sections + navigation — macOS System-Settings style: a sidebar of icon
// rows on the left, the active section on the right. Adding a section: append to TABS.

import { Activity, Cpu, type LucideIcon, Palette, Puzzle, Settings, Shield } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { AppearanceSection } from "./sections/appearance-section";
import { DiagnosticsSection } from "./sections/diagnostics-section";
import { PlaceholderSection } from "./sections/placeholder-section";
import { ProvidersSection } from "./sections/providers-section";

interface SettingsTab {
  id: string;
  label: string;
  icon: LucideIcon;
  component: () => React.JSX.Element;
}

const TABS: SettingsTab[] = [
  { id: "general", label: "General", icon: Settings, component: () => <PlaceholderSection title="General" description="Installation name, locale, default project settings and startup behavior." /> },
  { id: "appearance", label: "Appearance", icon: Palette, component: () => <AppearanceSection /> },
  { id: "providers", label: "Providers", icon: Cpu, component: () => <ProvidersSection /> },
  { id: "harnesses", label: "Harnesses", icon: Puzzle, component: () => <PlaceholderSection title="Harness registry" description="Member harness plugin support, fallback renderers and transformer plugins (ADR-0013/0015)." /> },
  { id: "security", label: "Security", icon: Shield, component: () => <PlaceholderSection title="Security" description="Sessions, PAT lifetime, secret rotation and data-residency policy." /> },
  { id: "diagnostics", label: "Diagnostics", icon: Activity, component: () => <DiagnosticsSection /> },
];

export function SettingsTabs({ initial = "general" }: { initial?: string }): React.JSX.Element {
  const [active, setActive] = useState(initial);
  const current = TABS.find((tab) => tab.id === active) ?? TABS[0]!;
  const Section = current.component;

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar navigation */}
      <nav
        aria-label="Settings sections"
        className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-transparent p-1 [box-shadow:1px_0_0_0_rgba(0,0,0,0.08)]"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={cn(
                "flex h-8 items-center gap-2 rounded-[var(--geist-radius)] px-2 text-left text-[13px] text-text-secondary hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
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
