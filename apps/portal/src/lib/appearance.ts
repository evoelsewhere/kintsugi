export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const THEME_STORAGE_KEY = "kintsugi-theme";
const MOTION_STORAGE_KEY = "kintsugi-reduced-motion";

function readStoredPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredPreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Keep the setting usable for this session when storage is unavailable.
  }
}

function prefers(query: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

function readMotionOverride(): boolean | null {
  const stored = readStoredPreference(MOTION_STORAGE_KEY);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return null;
}

function applyReducedMotion(reduced: boolean): void {
  document.documentElement.dataset.reducedMotion = String(reduced);
}

export function getThemePreference(): ThemeMode {
  const stored = readStoredPreference(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

export function getSystemTheme(): ResolvedTheme {
  return prefers(COLOR_SCHEME_QUERY) ? "dark" : "light";
}

export function setThemePreference(theme: ThemeMode): void {
  writeStoredPreference(THEME_STORAGE_KEY, theme);
  const dark = theme === "dark" || (theme === "system" && getSystemTheme() === "dark");
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function getReducedMotionPreference(): boolean {
  return readMotionOverride() ?? prefers(REDUCED_MOTION_QUERY);
}

export function getSystemReducedMotionPreference(): boolean {
  return prefers(REDUCED_MOTION_QUERY);
}

export function hasReducedMotionOverride(): boolean {
  return readMotionOverride() !== null;
}

export function setReducedMotionPreference(reduced: boolean): void {
  writeStoredPreference(MOTION_STORAGE_KEY, String(reduced));
  applyReducedMotion(reduced);
}

export function clearReducedMotionPreference(): boolean {
  try {
    window.localStorage.removeItem(MOTION_STORAGE_KEY);
  } catch {
    // The system preference still applies even when storage is unavailable.
  }
  const reduced = getSystemReducedMotionPreference();
  applyReducedMotion(reduced);
  return reduced;
}

export function initializeAppearance(): void {
  setThemePreference(getThemePreference());
  applyReducedMotion(getReducedMotionPreference());
}

export function subscribeToSystemAppearance(): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;

  const colorScheme = window.matchMedia(COLOR_SCHEME_QUERY);
  const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
  const updateTheme = (): void => {
    if (getThemePreference() === "system") setThemePreference("system");
  };
  const updateMotion = (): void => {
    if (readMotionOverride() === null) applyReducedMotion(reducedMotion.matches);
  };

  colorScheme.addEventListener("change", updateTheme);
  reducedMotion.addEventListener("change", updateMotion);
  return () => {
    colorScheme.removeEventListener("change", updateTheme);
    reducedMotion.removeEventListener("change", updateMotion);
  };
}
