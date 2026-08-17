import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { THEME_TOKEN_KEYS, emptyCustomization, fontFamily, normalizeCustomization } from "./themeTokens";
import type { FontKey, PaletteMode, ThemeCustomization, ThemeTokenKey } from "./themeTokens";

// Basic light/dark/system theming plus per-mode token overrides and a font
// choice (ADR-0009). Overrides are applied as inline CSS custom properties on
// <html>; the base values live in `index.css`'s `:root`/`.dark` blocks, so
// removing an inline override falls back to the default automatically.
//
// Theme mode and customization are desktop chrome, so both stay in
// `localStorage` rather than `config.toml` (ADR-0020) — the CLI has no use
// for them.
//
// A context rather than a bare hook: mode and customization are surfaced in
// the sidebar's quick toggle and the Appearance settings screen, and two
// `useState` instances would silently disagree after a change in one of them.
export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "codex-desktop-theme-mode";
const CUSTOMIZATION_KEY = "codex-desktop-theme-customization";

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function applyTheme(resolved: PaletteMode, customization: ThemeCustomization) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  // Kept in sync so native form controls, scrollbars and the webview's own
  // canvas follow the theme too — CSS `color-scheme` reads this.
  document.documentElement.style.colorScheme = resolved;
  const overrides = customization[resolved].tokens;
  for (const key of THEME_TOKEN_KEYS) {
    const hex = overrides[key];
    if (hex) document.documentElement.style.setProperty(`--${key}`, hex);
    else document.documentElement.style.removeProperty(`--${key}`);
  }
  document.documentElement.style.setProperty("--font-sans", fontFamily(customization.font));
}

interface ThemeValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /**
   * What `mode` currently resolves to — `system` is not a paintable value,
   * and the Appearance previews need to know which card is actually active.
   */
  resolved: PaletteMode;
  customization: ThemeCustomization;
  setToken: (mode: PaletteMode, token: ThemeTokenKey, hex: string | null) => void;
  resetModeTokens: (mode: PaletteMode) => void;
  setFont: (font: FontKey) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? "system",
  );
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [customization, setCustomization] = useState<ThemeCustomization>(() => {
    try {
      const raw = localStorage.getItem(CUSTOMIZATION_KEY);
      return raw ? normalizeCustomization(JSON.parse(raw)) : emptyCustomization();
    } catch {
      return emptyCustomization();
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(CUSTOMIZATION_KEY, JSON.stringify(customization));
  }, [customization]);

  useEffect(() => {
    const resolved = mode === "system" ? (systemDark ? "dark" : "light") : mode;
    applyTheme(resolved, customization);
  }, [mode, systemDark, customization]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setToken = useCallback((targetMode: PaletteMode, token: ThemeTokenKey, hex: string | null) => {
    setCustomization((prev) => {
      const tokens = { ...prev[targetMode].tokens };
      if (hex === null) delete tokens[token];
      else tokens[token] = hex;
      return { ...prev, [targetMode]: { tokens } };
    });
  }, []);

  const resetModeTokens = useCallback((targetMode: PaletteMode) => {
    setCustomization((prev) => ({ ...prev, [targetMode]: { tokens: {} } }));
  }, []);

  const setFont = useCallback((font: FontKey) => {
    setCustomization((prev) => ({ ...prev, font }));
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({
      mode,
      setMode,
      resolved: mode === "system" ? (systemDark ? "dark" : "light") : mode,
      customization,
      setToken,
      resetModeTokens,
      setFont,
    }),
    [mode, systemDark, customization, setToken, resetModeTokens, setFont],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
