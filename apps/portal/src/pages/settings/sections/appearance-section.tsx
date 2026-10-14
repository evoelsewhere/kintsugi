// Appearance — theme and motion preferences, stored per browser.

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  clearReducedMotionPreference,
  COLOR_SCHEME_QUERY,
  getReducedMotionPreference,
  getSystemReducedMotionPreference,
  getSystemTheme,
  getThemePreference,
  hasReducedMotionOverride,
  REDUCED_MOTION_QUERY,
  setReducedMotionPreference,
  setThemePreference,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/appearance";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{ id: ThemeMode; label: string; description: string; icon: typeof Sun }> = [
  { id: "light", label: "Light", description: "Bright, neutral surfaces", icon: Sun },
  { id: "dark", label: "Dark", description: "A low-light interface", icon: Moon },
  { id: "system", label: "System", description: "Match your device", icon: Monitor },
];

export function AppearanceSection(): React.JSX.Element {
  const [theme, setTheme] = useState<ThemeMode>(getThemePreference);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const [reduceMotion, setReduceMotion] = useState(getReducedMotionPreference);
  const [systemReduceMotion, setSystemReduceMotion] = useState(getSystemReducedMotionPreference);
  const [motionOverride, setMotionOverride] = useState(hasReducedMotionOverride);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const colorScheme = window.matchMedia(COLOR_SCHEME_QUERY);
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    const updateColorScheme = (): void => setSystemTheme(colorScheme.matches ? "dark" : "light");
    const updateMotionPreference = (): void => {
      setSystemReduceMotion(reducedMotion.matches);
      if (!motionOverride) setReduceMotion(reducedMotion.matches);
    };

    colorScheme.addEventListener("change", updateColorScheme);
    reducedMotion.addEventListener("change", updateMotionPreference);
    return () => {
      colorScheme.removeEventListener("change", updateColorScheme);
      reducedMotion.removeEventListener("change", updateMotionPreference);
    };
  }, [motionOverride]);

  const activeTheme: ResolvedTheme = theme === "system" ? systemTheme : theme;
  const activeThemeLabel = activeTheme === "dark" ? "Dark" : "Light";
  const ActiveThemeIcon = theme === "system" ? Monitor : activeTheme === "dark" ? Moon : Sun;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Theme</CardTitle>
              <CardDescription>Choose a fixed theme or follow your device. Changes apply immediately and are saved in this browser.</CardDescription>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-recessed px-2.5 py-1 text-[11px] font-medium text-text-secondary">
              <ActiveThemeIcon className="size-3.5" strokeWidth={1.75} />
              {theme === "system" ? `System · ${activeThemeLabel}` : `${activeThemeLabel} selected`}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = theme === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setTheme(option.id);
                    setThemePreference(option.id);
                  }}
                  className={cn(
                    "shadow-border flex min-h-24 flex-col items-start gap-2 rounded-[var(--geist-radius)] p-3 text-left text-text-secondary hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
                    selected && "bg-recessed text-text",
                  )}
                  style={selected ? { boxShadow: "var(--ds-shadow-border), 0 0 0 2px var(--ds-focus-color)" } : undefined}
                >
                  <span className="flex w-full items-center justify-between">
                    <span className={cn("flex size-8 items-center justify-center rounded-[var(--geist-radius)] bg-recessed", selected && "bg-surface")}>
                      <Icon className="size-4" strokeWidth={1.75} />
                    </span>
                    {selected ? <Check aria-hidden="true" className="size-4 text-accent" strokeWidth={2} /> : null}
                  </span>
                  <span className="text-[13px] font-medium">{option.label}</span>
                  <span className="text-[11px] leading-4 text-text-muted">{option.description}</span>
                </button>
              );
            })}
          </div>

          {theme === "system" ? (
            <p role="status" className="mt-3 text-[12px] text-text-muted">
              Following your device&apos;s {activeThemeLabel.toLowerCase()} appearance.
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-3 rounded-[var(--geist-radius)] bg-recessed p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-text">Live preview</p>
              <p className="mt-0.5 text-[11px] leading-4 text-text-muted">Surfaces, text, and controls update with the selected theme.</p>
            </div>
            <div aria-hidden="true" className="flex shrink-0 items-center gap-2">
              <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] text-text-secondary shadow-border">Surface</span>
              <span className="rounded-full bg-text px-2.5 py-1 text-[11px] font-medium text-background">Primary action</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Motion</CardTitle>
            <CardDescription>Set a calmer motion preference for the portal.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 rounded-[var(--geist-radius)] bg-recessed p-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Checkbox
                checked={reduceMotion}
                onChange={(checked) => {
                  setReduceMotion(checked);
                  setMotionOverride(true);
                  setReducedMotionPreference(checked);
                }}
                label="Reduce motion"
              />
              <p className="pl-6 text-[12px] leading-5 text-text-muted">
                Minimize non-essential transitions and animations. By default, this follows your device&apos;s motion preference.
              </p>
              <p aria-live="polite" className="pl-6 text-[11px] text-text-muted">
                {motionOverride
                  ? `Custom preference · ${reduceMotion ? "Reduced motion" : "Standard motion"}`
                  : `Following device · ${systemReduceMotion ? "Reduced motion" : "Standard motion"}`}
              </p>
            </div>
            {motionOverride ? (
              <button
                type="button"
                onClick={() => {
                  const systemPreference = clearReducedMotionPreference();
                  setReduceMotion(systemPreference);
                  setMotionOverride(false);
                }}
                className="shrink-0 self-start rounded-[var(--geist-radius)] px-2.5 py-1.5 text-[12px] text-text-secondary hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
              >
                Use system
              </button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
