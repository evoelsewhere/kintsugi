// Settings sections + tab bar. Rendered inside the settings modal (and reusable as a
// page body). Adding a section: append to TABS and implement the component.

import { useState } from "react";
import { cn } from "../../lib/utils";
import { AppearanceSection } from "./sections/appearance-section";
import { DiagnosticsSection } from "./sections/diagnostics-section";
import { PlaceholderSection } from "./sections/placeholder-section";
import { ProvidersSection } from "./sections/providers-section";

interface SettingsTab {
  id: string;
  label: string;
  component: () => React.JSX.Element;
}

const TABS: SettingsTab[] = [
  { id: "general", label: "General", component: () => <PlaceholderSection title="General" description="Installation name, locale, default project settings and startup behavior." /> },
  { id: "appearance", label: "Appearance", component: () => <AppearanceSection /> },
  { id: "providers", label: "Providers", component: () => <ProvidersSection /> },
  { id: "harnesses", label: "Harnesses", component: () => <PlaceholderSection title="Harness registry" description="Member harness plugin support, fallback renderers and transformer plugins (ADR-0013/0015)." /> },
  { id: "security", label: "Security", component: () => <PlaceholderSection title="Security" description="Sessions, PAT lifetime, secret rotation and data-residency policy." /> },
  { id: "diagnostics", label: "Diagnostics", component: () => <DiagnosticsSection /> },
];

export function SettingsTabs({ initial = "general" }: { initial?: string }): React.JSX.Element {
  const [active, setActive] = useState(initial);
  const current = TABS.find((tab) => tab.id === active) ?? TABS[0]!;
  const Section = current.component;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Settings sections" className="flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={cn(
              "h-9 rounded-[var(--geist-radius)] px-3.5 text-[14px] text-text-secondary hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
              tab.id === active && "bg-hover font-medium text-text",
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <Section />
    </div>
  );
}
