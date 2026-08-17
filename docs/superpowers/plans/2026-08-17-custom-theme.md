# 自定义主题色与字体 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Codex Desktop 外观设置中加入全部颜色 token（浅/深模式各自独立）与预设字体栈的自定义，落地 ADR-0009 延期项。

**Architecture:** 新增纯逻辑模块 `themeTokens.ts` 作为 token 元数据、默认调色板与字体预设的单一数据源；扩展 `useTheme.ts` 以持有/持久化 `ThemeCustomization` 并把解析后模式的 token 覆盖以内联 CSS 变量写到 `<html>` 上（基础值留在 `index.css`，移除内联覆盖即回落默认）；外观设置页把占位的「自定义」区替换为 tab + 分组取色编辑器和字体选择。

**Tech Stack:** React 18 + TypeScript、Tailwind CSS v4、shadcn/ui 风格组件（Radix Popover）、`react-colorful` 取色库、Vite、pnpm workspace。

## Global Constraints

- 包管理用 **pnpm**（根目录 workspace，`.npmrc` 含 pnpm 专属配置；绝不用 npm/yarn）。
- 每次任务的验证命令：在 `codex-desktop/ui` 目录下运行 `pnpm build`（= `tsc --noEmit && vite build`）。该 UI 无测试框架，构建即验证门槛。
- UI 文案为中文，与现有设置页一致。
- 只新增 `react-colorful` 一个依赖；不改 `--font-mono`（代码用等宽，保持默认）。
- 持久化全部在 `localStorage`（桌面 chrome，ADR-0020）：模式 key `codex-desktop-theme-mode`（不动），新增 key `codex-desktop-theme-customization`。
- 不触碰 Rust 代码与 `codex-rs/` 下的任何东西。
- 文件注释遵循各文件既有风格（关键处加"与 index.css 保持同步"之类注释），不写无关注释。

---

### Task 1: 添加 react-colorful 依赖

**Files:**
- Modify: `codex-desktop/ui/package.json`（由命令自动写入）
- Modify: `pnpm-lock.yaml`（根目录，由命令自动更新）

**Interfaces:**
- Produces: `react-colorful` 安装可用，`import { HexColorPicker } from "react-colorful"` 与 `@import "react-colorful/styles.css"` 可解析。

- [ ] **Step 1: 安装依赖**

在仓库根目录运行：

```bash
pnpm --filter codex-desktop-ui add react-colorful
```

- [ ] **Step 2: 确认变更落点**

检查 `codex-desktop/ui/package.json` 的 `dependencies` 中出现 `"react-colorful"`（^6.x），根目录 `pnpm-lock.yaml` 已更新且无报错。

- [ ] **Step 3: 验证构建**

```bash
cd codex-desktop/ui && pnpm build
```

预期：`tsc --noEmit` 与 `vite build` 均通过，`dist/` 生成。

- [ ] **Step 4: 提交**

```bash
git add codex-desktop/ui/package.json pnpm-lock.yaml && git commit -m "feat(desktop): add react-colorful for theme token editing"
```

---

### Task 2: 新建 themeTokens.ts（token 元数据 + 默认调色板 + 字体预设）

**Files:**
- Create: `codex-desktop/ui/src/themeTokens.ts`

**Interfaces:**
- Consumes: 无（纯模块）。
- Produces:
  - `export const THEME_TOKEN_KEYS: readonly ThemeTokenKey[]`（24 个 key）
  - `export type ThemeTokenKey`
  - `export interface TokenDef { key: ThemeTokenKey; label: string }`
  - `export interface TokenGroup { id: string; label: string; tokens: TokenDef[] }`
  - `export const TOKEN_GROUPS: TokenGroup[]`（10 组，含中文标签）
  - `export type PaletteMode = "light" | "dark"`
  - `export const DEFAULT_PALETTE: Record<PaletteMode, Record<ThemeTokenKey, string>>`
  - `export type TokenOverrides = Partial<Record<ThemeTokenKey, string>>`
  - `export function effectivePalette(mode: PaletteMode, overrides: TokenOverrides): Record<ThemeTokenKey, string>`
  - `export function isHexColor(value: string): boolean`
  - `export type FontKey = "system" | "pingfang" | "yahei" | "noto" | "mono"`
  - `export interface FontOption { key: FontKey; label: string; family: string }`
  - `export const FONTS: FontOption[]`
  - `export function fontFamily(font: FontKey): string`
  - `export interface ModePalette { tokens: TokenOverrides }`
  - `export interface ThemeCustomization { font: FontKey; light: ModePalette; dark: ModePalette }`
  - `export function emptyCustomization(): ThemeCustomization`
  - `export function normalizeCustomization(raw: unknown): ThemeCustomization`

- [ ] **Step 1: 写入完整文件**

创建 `codex-desktop/ui/src/themeTokens.ts`：

```ts
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

export function effectivePalette(mode: PaletteMode, overrides: TokenOverrides): Record<ThemeTokenKey, string> {
  const palette = { ...DEFAULT_PALETTE[mode] };
  for (const key of THEME_TOKEN_KEYS) {
    const value = overrides[key];
    if (value) palette[key] = value;
  }
  return palette;
}

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
  font: FontKey;
  light: ModePalette;
  dark: ModePalette;
}

export function emptyCustomization(): ThemeCustomization {
  return { font: "system", light: { tokens: {} }, dark: { tokens: {} } };
}

export function normalizeCustomization(raw: unknown): ThemeCustomization {
  const empty = emptyCustomization();
  if (typeof raw !== "object" || raw === null) return empty;
  const obj = raw as Record<string, unknown>;
  const font = FONTS.some((option) => option.key === obj.font) ? (obj.font as FontKey) : empty.font;
  return {
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
```

- [ ] **Step 2: 验证构建**

```bash
cd codex-desktop/ui && pnpm build
```

预期：类型检查通过（无未使用导出告警导致的失败；tsconfig 默认不把未使用导出视为错误）。

- [ ] **Step 3: 提交**

```bash
git add codex-desktop/ui/src/themeTokens.ts && git commit -m "feat(desktop): add theme token metadata, default palette and font presets"
```

---

### Task 3: 扩展 useTheme.ts（自定义状态、应用与持久化）

**Files:**
- Modify: `codex-desktop/ui/src/useTheme.ts`（整体重写为下方内容）

**Interfaces:**
- Consumes: Task 2 的 `THEME_TOKEN_KEYS`、`emptyCustomization`、`normalizeCustomization`、`fontFamily` 与类型 `FontKey`、`PaletteMode`、`ThemeCustomization`、`ThemeTokenKey`。
- Produces（`ThemeValue` 新增字段/方法，供 Task 5、6 使用）：
  - `customization: ThemeCustomization`
  - `setToken(mode: PaletteMode, token: ThemeTokenKey, hex: string | null): void`（null = 重置该 token）
  - `resetModeTokens(mode: PaletteMode): void`
  - `setFont(font: FontKey): void`

- [ ] **Step 1: 重写文件**

将 `codex-desktop/ui/src/useTheme.ts` 整体替换为：

```ts
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
```

- [ ] **Step 2: 验证构建**

```bash
cd codex-desktop/ui && pnpm build
```

预期：`tsc --noEmit` 通过。检查 `useTheme.ts` 中 `customization[resolved]`（`resolved: PaletteMode`）索引 `ThemeCustomization` 的 `light`/`dark` 键在类型上正确。

- [ ] **Step 3: 提交**

```bash
git add codex-desktop/ui/src/useTheme.ts && git commit -m "feat(desktop): persist and apply per-mode theme token overrides and font"
```

---

### Task 4: 新建 ColorControl（单 token 行控件）

**Files:**
- Create: `codex-desktop/ui/src/components/settings/ColorControl.tsx`

**Interfaces:**
- Consumes: Task 2 的 `isHexColor`；现有 `Popover/PopoverContent/PopoverTrigger`（`@/components/ui/popover`）；`react-colorful` 的 `HexColorPicker`。
- Produces:
  - `export function ColorControl(props: ColorControlProps): JSX.Element`
  - `interface ColorControlProps { label: string; value: string; defaultValue: string; overridden: boolean; onCommit: (hex: string | null) => void }`

- [ ] **Step 1: 写入完整文件**

创建 `codex-desktop/ui/src/components/settings/ColorControl.tsx`：

```tsx
import { useEffect, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { RotateCcw } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isHexColor } from "../../themeTokens";
import { cn } from "@/lib/utils";

interface ColorControlProps {
  label: string;
  /** 当前生效色（覆盖或默认）。 */
  value: string;
  /** 内置默认色，弱化显示。 */
  defaultValue: string;
  /** 是否为覆盖态（决定是否显示重置按钮）。 */
  overridden: boolean;
  /** null = 恢复默认。 */
  onCommit: (hex: string | null) => void;
}

export function ColorControl({ label, value, defaultValue, overridden, onCommit }: ColorControlProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commitDraft() {
    const hex = draft.trim();
    if (isHexColor(hex)) {
      onCommit(hex.toLowerCase());
    } else {
      setDraft(value);
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground/70">
          默认 {defaultValue.toLowerCase()}
        </div>
      </div>
      {overridden && (
        <button
          type="button"
          onClick={() => onCommit(null)}
          aria-label={`恢复 ${label} 默认色`}
          title="恢复默认"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RotateCcw className="size-3.5" />
        </button>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`编辑 ${label} 颜色`}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 hover:bg-accent",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <span
              className="size-4 rounded border border-black/10"
              style={{ backgroundColor: value }}
            />
            <span className="font-mono text-xs">{value.toLowerCase()}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-60">
          <HexColorPicker color={value} onChange={(hex) => onCommit(hex)} />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitDraft();
            }}
            aria-label={`${label} 十六进制色值`}
            className="mt-2 h-8 w-full rounded-lg border border-input bg-background px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 2: 验证构建**

```bash
cd codex-desktop/ui && pnpm build
```

预期：类型检查与构建通过；确认 `react-colorful` 的 `HexColorPicker` 导入可解析。

- [ ] **Step 3: 提交**

```bash
git add codex-desktop/ui/src/components/settings/ColorControl.tsx && git commit -m "feat(desktop): add per-token color control with picker and reset"
```

---

### Task 5: 新建 ThemeTokenEditor（模式 tab + 分组 token 编辑）

**Files:**
- Create: `codex-desktop/ui/src/components/settings/ThemeTokenEditor.tsx`

**Interfaces:**
- Consumes: Task 2 的 `DEFAULT_PALETTE`、`TOKEN_GROUPS`、`effectivePalette` 与类型 `PaletteMode`、`ThemeCustomization`、`ThemeTokenKey`；Task 4 的 `ColorControl`；现有 `Button`。
- Produces:
  - `export function ThemeTokenEditor(props: ThemeTokenEditorProps): JSX.Element`
  - `interface ThemeTokenEditorProps { customization: ThemeCustomization; setToken: (mode: PaletteMode, token: ThemeTokenKey, hex: string | null) => void; resetModeTokens: (mode: PaletteMode) => void }`

- [ ] **Step 1: 写入完整文件**

创建 `codex-desktop/ui/src/components/settings/ThemeTokenEditor.tsx`：

```tsx
import { useState } from "react";
import { Check } from "lucide-react";

import { DEFAULT_PALETTE, TOKEN_GROUPS, effectivePalette } from "../../themeTokens";
import type { PaletteMode, ThemeCustomization, ThemeTokenKey } from "../../themeTokens";
import { ColorControl } from "./ColorControl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MODES: { mode: PaletteMode; label: string }[] = [
  { mode: "light", label: "浅色" },
  { mode: "dark", label: "深色" },
];

interface ThemeTokenEditorProps {
  customization: ThemeCustomization;
  setToken: (mode: PaletteMode, token: ThemeTokenKey, hex: string | null) => void;
  resetModeTokens: (mode: PaletteMode) => void;
}

export function ThemeTokenEditor({ customization, setToken, resetModeTokens }: ThemeTokenEditorProps) {
  const [mode, setMode] = useState<PaletteMode>("light");
  const palette = effectivePalette(mode, customization[mode].tokens);

  return (
    <div className="divide-y divide-border">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex rounded-lg border border-border bg-muted/50 p-0.5">
          {MODES.map(({ mode: candidate, label }) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              onClick={() => setMode(candidate)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px]",
                mode === candidate
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {mode === candidate && <Check className="size-3.5" />}
              {label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => resetModeTokens(mode)}>
          恢复默认
        </Button>
      </div>

      {TOKEN_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">
            {group.label}
          </div>
          {group.tokens.map(({ key, label }) => (
            <ColorControl
              key={key}
              label={label}
              value={palette[key]}
              defaultValue={DEFAULT_PALETTE[mode][key]}
              overridden={customization[mode].tokens[key] !== undefined}
              onCommit={(hex) => setToken(mode, key, hex)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 验证构建**

```bash
cd codex-desktop/ui && pnpm build
```

预期：类型检查与构建通过。

- [ ] **Step 3: 提交**

```bash
git add codex-desktop/ui/src/components/settings/ThemeTokenEditor.tsx && git commit -m "feat(desktop): add per-mode theme token editor with grouped rows"
```

---

### Task 6: 接线外观设置页 + 预览卡片 + react-colorful 样式

**Files:**
- Modify: `codex-desktop/ui/src/components/settings/AppearanceSettings.tsx`（整体替换）
- Modify: `codex-desktop/ui/src/index.css`

**Interfaces:**
- Consumes: Task 2 的 `FONTS`、`effectivePalette` 与类型 `PaletteMode`、`ThemeTokenKey`；Task 3 的 `useTheme` 返回值（含 `customization`/`setToken`/`resetModeTokens`/`setFont`）；Task 5 的 `ThemeTokenEditor`；现有 `SettingsHeader`/`SettingsSection`/`SettingRow`、`Select`。

- [ ] **Step 1: 改写 AppearanceSettings.tsx**

将 `codex-desktop/ui/src/components/settings/AppearanceSettings.tsx` 整体替换为：

```tsx
import { Check } from "lucide-react";

import { useTheme } from "../../useTheme";
import type { ThemeMode } from "../../useTheme";
import { FONTS, effectivePalette } from "../../themeTokens";
import type { PaletteMode, ThemeTokenKey } from "../../themeTokens";
import { SettingsHeader, SettingsSection, SettingRow } from "./SettingsPrimitives";
import { ThemeTokenEditor } from "./ThemeTokenEditor";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Follows reference screenshot 03's three preview cards, plus the token
// editor and font picker ADR-0009 originally deferred — now implemented.
//
// Theme mode and customization stay in `localStorage` via `useTheme`, not
// `config.toml`: they are desktop chrome, and the CLI has no use for them
// (ADR-0020).

const THEMES: { mode: ThemeMode; label: string }[] = [
  { mode: "system", label: "系统" },
  { mode: "light", label: "浅色" },
  { mode: "dark", label: "深色" },
];

export function AppearanceSettings() {
  const { mode, setMode, customization, setToken, resetModeTokens, setFont } = useTheme();
  const palette: Record<PaletteMode, Record<ThemeTokenKey, string>> = {
    light: effectivePalette("light", customization.light.tokens),
    dark: effectivePalette("dark", customization.dark.tokens),
  };

  return (
    <>
      <SettingsHeader title="外观" />

      <SettingsSection title="主题">
        <div className="grid grid-cols-3 gap-4 px-4 py-3.5">
          {THEMES.map((theme) => (
            <button
              key={theme.mode}
              type="button"
              aria-pressed={mode === theme.mode}
              onClick={() => setMode(theme.mode)}
              className="group flex flex-col gap-2 text-left"
            >
              <div
                className={cn(
                  "relative aspect-[4/3] overflow-hidden rounded-xl border-2 transition-colors",
                  mode === theme.mode
                    ? "border-primary"
                    : "border-border group-hover:border-muted-foreground/40",
                )}
              >
                <ThemePreview mode={theme.mode} palette={palette} />
                {mode === theme.mode && (
                  <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3" />
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "text-center text-[13px]",
                  mode === theme.mode ? "font-medium" : "text-muted-foreground",
                )}
              >
                {theme.label}
              </span>
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="自定义">
        <SettingRow
          label="字体"
          description="界面字体；代码内容保持等宽字体不变。"
          control={
            <Select
              value={customization.font}
              options={FONTS.map(({ key, label }) => ({ value: key, label }))}
              onValueChange={setFont}
            />
          }
        />
        <ThemeTokenEditor
          customization={customization}
          setToken={setToken}
          resetModeTokens={resetModeTokens}
        />
      </SettingsSection>
    </>
  );
}

/**
 * A miniature of the app's own two-pane layout, painted from the effective
 * palette so each card shows what that theme looks like *now* — including any
 * custom overrides. The "系统" card deliberately shows both halves at once.
 */
function ThemePreview({
  mode,
  palette,
}: {
  mode: ThemeMode;
  palette: Record<PaletteMode, Record<ThemeTokenKey, string>>;
}) {
  if (mode === "system") {
    return (
      <div className="flex size-full">
        <div className="w-1/2 overflow-hidden">
          <PreviewPane palette={palette.light} />
        </div>
        <div className="w-1/2 overflow-hidden">
          <PreviewPane palette={palette.dark} />
        </div>
      </div>
    );
  }
  return <PreviewPane palette={palette[mode]} />;
}

function PreviewPane({ palette }: { palette: Record<ThemeTokenKey, string> }) {
  const bg = palette.background;
  const rail = palette.sidebar;
  const line = palette.border;
  const block = palette.accent;

  return (
    <div className="flex size-full" style={{ backgroundColor: bg }}>
      <div className="flex w-1/3 flex-col gap-1 p-1.5" style={{ backgroundColor: rail }}>
        {[70, 55, 60].map((width, index) => (
          <span
            key={index}
            className="h-1 rounded-full"
            style={{ width: `${width}%`, backgroundColor: line }}
          />
        ))}
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1 p-1.5">
        {[85, 65].map((width, index) => (
          <span
            key={index}
            className="h-1.5 rounded-full"
            style={{ width: `${width}%`, backgroundColor: block }}
          />
        ))}
        <span
          className="mt-1 h-3 w-full rounded"
          style={{ backgroundColor: block, border: `1px solid ${line}` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 给 index.css 加 react-colorful 样式**

在 `codex-desktop/ui/src/index.css` 顶部、`@import "tailwindcss";` 之前加入：

```css
@import "react-colorful/styles.css";
```

在 `@layer components { ... }` 块内（`@keyframes` 之后）追加：

```css
  /* react-colorful picker inside the Appearance popover: fill the popover
     and match the app's radius so it doesn't read as a foreign widget. */
  .react-colorful {
    width: 100%;
  }

  .react-colorful__saturation {
    border-radius: calc(var(--radius) - 2px);
  }

  .react-colorful__last-control {
    border-radius: var(--radius);
  }
```

- [ ] **Step 3: 验证构建**

```bash
cd codex-desktop/ui && pnpm build
```

预期：`tsc --noEmit` 与 `vite build` 通过；确认 `@import "react-colorful/styles.css"` 被 Vite 正确解析打包（构建无"Failed to resolve import"类报错）。

- [ ] **Step 4: 运行时冒烟检查**

由用户在 Tauri 应用（`npm run tauri dev` 或已构建版本）中手工验证：

1. 外观设置 → 自定义：字体下拉可选并即时生效。
2. 浅色/深色 tab 各自独立编辑；改动某 token，界面即时变色。
3. 取色器拖动、hex 输入合法值回车/失焦应用、非法值不生效并回退显示。
4. 行内与区块级「恢复默认」生效。
5. 「跟随系统」模式下解析到浅色/深色时分别应用对应自定义；侧栏快捷切换同步。
6. 重启应用后自定义仍保留。

- [ ] **Step 5: 提交**

```bash
git add codex-desktop/ui/src/components/settings/AppearanceSettings.tsx codex-desktop/ui/src/index.css && git commit -m "feat(desktop): wire custom theme token editor and font picker into appearance settings"
```

---

## Self-Review 结果

- **Spec 覆盖**：全部 token（Task 2/5/6，24 个颜色 token，排除 radius）、每套模式独立（Task 3 的 `light`/`dark` 两个 ModePalette + Task 5 tab）、预设字体栈（Task 2 FONTS + Task 6 Select）、localStorage 持久化（Task 3）、预览卡片反映自定义（Task 6）、无 contrast（全局约束未纳入）、hex 非法输入不应用（Task 4 `commitDraft`）。
- **占位符扫描**：无 TODO/TBD；每个步骤含完整代码。
- **类型一致性**：`PaletteMode`/`ThemeTokenKey`/`ThemeCustomization`/`FontKey` 在 Task 2 定义并在 Task 3–6 使用；`setToken`/`resetModeTokens`/`setFont` 签名在 Task 3 定义，Task 5/6 传入并调用，一致。
