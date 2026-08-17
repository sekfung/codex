// Codex Desktop 主题 token 的单一数据源（ADR-0019、ADR-0009）。
// DEFAULT_PALETTE 中的值必须与 src/index.css 的 `:root` / `.dark` 块保持同步。

export const THEME_TOKEN_KEYS = [
  "background", "foreground",
  "card", "card-foreground",
  "popover", "popover-foreground",
  "primary", "primary-foreground",
  "secondary", "secondary-foreground",
  "muted", "muted-foreground",
  "accent", "accent-foreground",
  "destructive", "destructive-foreground",
  "border", "input", "ring",
  "sidebar", "sidebar-foreground", "sidebar-accent", "sidebar-accent-foreground", "sidebar-border",
] as const;

export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];

export interface TokenDef {
  key: ThemeTokenKey;
  label: string;
}

export interface TokenGroup {
  id: string;
  label: string;
  tokens: TokenDef[];
}

export const TOKEN_GROUPS: TokenGroup[] = [
  {
    id: "background",
    label: "背景与前景",
    tokens: [
      { key: "background", label: "背景" },
      { key: "foreground", label: "前景" },
    ],
  },
  {
    id: "primary",
    label: "主色",
    tokens: [
      { key: "primary", label: "主色" },
      { key: "primary-foreground", label: "主色前景" },
    ],
  },
  {
    id: "card",
    label: "卡片",
    tokens: [
      { key: "card", label: "卡片背景" },
      { key: "card-foreground", label: "卡片前景" },
    ],
  },
  {
    id: "popover",
    label: "弹出层",
    tokens: [
      { key: "popover", label: "弹出层背景" },
      { key: "popover-foreground", label: "弹出层前景" },
    ],
  },
  {
    id: "secondary",
    label: "次级",
    tokens: [
      { key: "secondary", label: "次级背景" },
      { key: "secondary-foreground", label: "次级前景" },
    ],
  },
  {
    id: "muted",
    label: "弱化",
    tokens: [
      { key: "muted", label: "弱化背景" },
      { key: "muted-foreground", label: "弱化前景" },
    ],
  },
  {
    id: "accent",
    label: "强调",
    tokens: [
      { key: "accent", label: "强调背景" },
      { key: "accent-foreground", label: "强调前景" },
    ],
  },
  {
    id: "destructive",
    label: "危险",
    tokens: [
      { key: "destructive", label: "危险背景" },
      { key: "destructive-foreground", label: "危险前景" },
    ],
  },
  {
    id: "border",
    label: "边框 / 输入 / 焦点环",
    tokens: [
      { key: "border", label: "边框" },
      { key: "input", label: "输入框" },
      { key: "ring", label: "焦点环" },
    ],
  },
  {
    id: "sidebar",
    label: "侧栏",
    tokens: [
      { key: "sidebar", label: "侧栏背景" },
      { key: "sidebar-foreground", label: "侧栏前景" },
      { key: "sidebar-accent", label: "侧栏强调背景" },
      { key: "sidebar-accent-foreground", label: "侧栏强调前景" },
      { key: "sidebar-border", label: "侧栏边框" },
    ],
  },
];

export type PaletteMode = "light" | "dark";

export const THEME_KEYS = [
  "default",
  "modern-minimal",
  "clean-slate",
  "amber-minimal",
  "corporate",
  "graphite",
  "mono",
] as const;

export type ThemeKey = (typeof THEME_KEYS)[number];

// 与 src/index.css 的 `:root` / `.dark` 块保持同步。
export const DEFAULT_PALETTE: Record<PaletteMode, Record<ThemeTokenKey, string>> = {
  light: {
    background: "#ffffff",
    foreground: "#1a1c1f",
    card: "#ffffff",
    "card-foreground": "#1a1c1f",
    popover: "#ffffff",
    "popover-foreground": "#1a1c1f",
    primary: "#339cff",
    "primary-foreground": "#08121c",
    secondary: "#f2f2f1",
    "secondary-foreground": "#1a1c1f",
    muted: "#f4f4f3",
    "muted-foreground": "#83888f",
    accent: "#f0f0ef",
    "accent-foreground": "#1a1c1f",
    destructive: "#d64545",
    "destructive-foreground": "#ffffff",
    border: "#e7e7e5",
    input: "#e2e2e0",
    ring: "#339cff",
    sidebar: "#f9f9f8",
    "sidebar-foreground": "#1a1c1f",
    "sidebar-accent": "#ececeb",
    "sidebar-accent-foreground": "#1a1c1f",
    "sidebar-border": "#e7e7e5",
  },
  dark: {
    background: "#1a1c1f",
    foreground: "#ecedee",
    card: "#1f2225",
    "card-foreground": "#ecedee",
    popover: "#212427",
    "popover-foreground": "#ecedee",
    primary: "#339cff",
    "primary-foreground": "#08121c",
    secondary: "#26292d",
    "secondary-foreground": "#ecedee",
    muted: "#24272b",
    "muted-foreground": "#9ba1a8",
    accent: "#2a2e33",
    "accent-foreground": "#ecedee",
    destructive: "#e06666",
    "destructive-foreground": "#1a1c1f",
    border: "#2b2f34",
    input: "#33383d",
    ring: "#339cff",
    sidebar: "#141619",
    "sidebar-foreground": "#ecedee",
    "sidebar-accent": "#24272b",
    "sidebar-accent-foreground": "#ecedee",
    "sidebar-border": "#24272b",
  },
};

export type TokenOverrides = Partial<Record<ThemeTokenKey, string>>;

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value);
}

export type FontKey = "system" | "pingfang" | "yahei" | "noto" | "mono";

export interface FontOption {
  key: FontKey;
  label: string;
  family: string;
}

export const FONTS: FontOption[] = [
  {
    key: "system",
    label: "系统默认",
    // Keep in sync with index.css --font-sans.
    family:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  {
    key: "pingfang",
    label: "苹方",
    family: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
  },
  {
    key: "yahei",
    label: "微软雅黑",
    family: '"Microsoft YaHei", "PingFang SC", "Segoe UI", system-ui, sans-serif',
  },
  {
    key: "noto",
    label: "思源黑体",
    family:
      '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
  {
    key: "mono",
    label: "系统等宽",
    family:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },
];

export function fontFamily(font: FontKey): string {
  return FONTS.find((option) => option.key === font)?.family ?? FONTS[0].family;
}

export interface ModePalette {
  tokens: TokenOverrides;
}

export interface ThemeCustomization {
  theme: ThemeKey;
  font: FontKey;
  light: ModePalette;
  dark: ModePalette;
}

export function emptyCustomization(): ThemeCustomization {
  return { theme: "default", font: "system", light: { tokens: {} }, dark: { tokens: {} } };
}

export function normalizeCustomization(raw: unknown): ThemeCustomization {
  const empty = emptyCustomization();
  if (typeof raw !== "object" || raw === null) return empty;
  const obj = raw as Record<string, unknown>;
  const theme = THEME_KEYS.includes(obj.theme as ThemeKey) ? (obj.theme as ThemeKey) : empty.theme;
  const font = FONTS.some((option) => option.key === obj.font) ? (obj.font as FontKey) : empty.font;
  return {
    theme,
    font,
    light: normalizeModePalette(obj.light),
    dark: normalizeModePalette(obj.dark),
  };
}

function normalizeModePalette(raw: unknown): ModePalette {
  const tokens: TokenOverrides = {};
  if (typeof raw === "object" && raw !== null) {
    const stored = (raw as { tokens?: unknown }).tokens;
    if (typeof stored === "object" && stored !== null) {
      for (const key of THEME_TOKEN_KEYS) {
        const value = (stored as Record<string, unknown>)[key];
        if (typeof value === "string" && isHexColor(value)) tokens[key] = value.toLowerCase();
      }
    }
  }
  return { tokens };
}
