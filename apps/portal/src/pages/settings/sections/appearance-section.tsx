// Appearance — theme selection (light / dark / system), stored per browser.

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { cn } from "../../../lib/utils";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "kintsugi-theme";

const OPTIONS: Array<{ id: Theme; label: string; icon: typeof Sun }> = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

function apply(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function AppearanceSection(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system");

  useEffect(() => {
    apply(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Theme</CardTitle>
          <CardDescription>Appearance follows the Kintsugi design language (DESIGN.md) in every mode.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setTheme(option.id)}
                className={cn(
                  "shadow-border flex items-center gap-2 rounded-[var(--geist-radius)] px-2.5 py-2 text-left text-[13px] text-text-secondary hover:bg-hover hover:text-text",
                  theme === option.id && "bg-hover text-text",
                )}
                style={theme === option.id ? { boxShadow: "var(--ds-shadow-border), 0 0 0 2px var(--ds-focus-color)" } : undefined}
              >
                <Icon className="size-4" strokeWidth={1.75} />
                {option.label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
