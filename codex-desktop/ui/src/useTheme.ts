import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

// Basic light/dark/system theming only (ADR-0009). The token-diff custom
// theme editor seen in the Official App's reference screenshots is deferred
// to v2 — this just toggles the `.dark` class on <html>, which is the
// convention `index.css`'s `@custom-variant dark (&:is(.dark *))` and every
// shadcn `dark:` utility are written against (ADR-0019).
//
// Theme mode is desktop chrome, so it stays in `localStorage` rather than
// `config.toml` (ADR-0020) — the CLI has no use for it.
//
// Deliberately a context rather than a bare hook: the mode is now surfaced in
// two places at once (the sidebar's quick toggle and the Appearance settings
// screen). Two `useState` instances would each hold their own copy and
// silently disagree after a change in one of them.
export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "codex-desktop-theme-mode";

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function applyResolvedTheme(resolved: "light" | "dark") {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  // Kept in sync so native form controls, scrollbars and the webview's own
  // canvas follow the theme too — CSS `color-scheme` reads this.
  document.documentElement.style.colorScheme = resolved;
}

interface ThemeValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /**
   * What `mode` currently resolves to — `system` is not a paintable value,
   * and the Appearance previews need to know which card is actually active.
   */
  resolved: "light" | "dark";
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? "system",
  );
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    applyResolvedTheme(mode === "system" ? (systemDark ? "dark" : "light") : mode);
  }, [mode, systemDark]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({
      mode,
      setMode,
      resolved: mode === "system" ? (systemDark ? "dark" : "light") : mode,
    }),
    [mode, systemDark],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
