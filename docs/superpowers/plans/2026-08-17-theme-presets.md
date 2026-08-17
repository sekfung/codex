# 预设主题一键切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Codex Desktop 外观设置中加入「预设主题」chip 区，内置 shadcn.io Minimal 系列 6 个主题为基准色板，用户仍可在其上逐 token 微调（spec `docs/superpowers/specs/2026-08-17-theme-presets-design.md`）。

**Architecture:** `ThemeCustomization` 增加 `theme: ThemeKey` 作为基准键；新增 `themePresets.ts`（元数据 + `basePalette` + 新签名 `effectivePalette(mode, customization)`）与脚本生成的 `themePresetData.ts`（6 主题 × 浅/深 × 24 token 的 hex 常量）；`applyTheme` 改为把 24 个有效色值全部写内联（基准 + 覆盖）；外观设置页新增 chip 网格。预设做底、微调叠加、老数据自动兼容。

**Tech Stack:** React 18 + TypeScript、Tailwind CSS v4、shadcn/ui 风格组件、Vite、pnpm workspace。

## Global Constraints

- 包管理用 **pnpm**（根 workspace，`.npmrc` 含 pnpm 专属配置；绝不用 npm/yarn）。
- 每次任务的验证命令：在 `codex-desktop/ui` 目录运行 `pnpm build`（= `tsc --noEmit && vite build`）。该 UI 无测试框架，构建即验证门槛。构建通过后再提交。
- UI 文案为中文；代码注释为英文（沿用现有文件风格）。
- 只允许触碰：`codex-desktop/ui/src/themeTokens.ts`、新建 `themePresets.ts`、脚本生成的 `themePresetData.ts`、`codex-desktop/ui/src/useTheme.ts`、`codex-desktop/ui/src/components/settings/{AppearanceSettings,ThemeTokenEditor,ColorControl}.tsx`。
- **禁止触碰预存脏文件**（与本任务无关）：`codex-desktop/Cargo.toml`、`codex-desktop/icons/*.png`、`codex-desktop/ui/src/components/settings/HooksSettings.tsx`、`codex-desktop/ui/src/types.ts`。
- 提交只用显式路径 `git add <file>...`（绝不用 `-A`/`-u`/`.`）。提交信息遵循仓库风格（`feat(desktop): ...`）。
- 预设只影响 24 个颜色 token；不改变 `--radius`、`--chart-*`、字体（字体仍走独立 `FONTS`）。`--sidebar-primary`/`--sidebar-primary-foreground`/`--sidebar-ring` 不在 `THEME_TOKEN_KEYS` 内，忽略。
- 不新增运行时依赖。

---

### Task 1: 预设色板数据与主题键类型

**Files:**
- Create（SDD 工作区，已存在且已验证）: `.superpowers/sdd/2026-08-17-custom-theme/oklch-to-hex.mjs`
- Generate: `codex-desktop/ui/src/themePresetData.ts`（运行上述脚本产出；当前已生成在工作区，验证后提交）
- Create: `codex-desktop/ui/src/themePresets.ts`
- Modify: `codex-desktop/ui/src/themeTokens.ts`

**Interfaces:**
- Consumes: `THEME_TOKEN_KEYS`、`DEFAULT_PALETTE`、`PaletteMode`、`ThemeTokenKey`、`ThemeCustomization`（均来自 `themeTokens.ts`）。
- Produces:
  - `themeTokens.ts` 新增：`THEME_KEYS: readonly ThemeKey[]`、`type ThemeKey`、`ThemeCustomization.theme: ThemeKey`。
  - `themePresets.ts` 新增：`THEME_PRESETS: { key: ThemeKey; label: string }[]`、`basePalette(mode: PaletteMode, theme: ThemeKey): Record<ThemeTokenKey, string>`。
  - `themePresetData.ts`：`PRESET_PALETTES`。

- [ ] **Step 1: 运行转换脚本生成数据文件**

脚本内容已写入 `.superpowers/sdd/2026-08-17-custom-theme/oklch-to-hex.mjs`（本任务步骤 2 末尾附全文备查）。运行：

```bash
node ".superpowers/sdd/2026-08-17-custom-theme/oklch-to-hex.mjs"
```

Expected: 输出 `wrote C:/Users/sekfung/RustroverProjects/codex/codex-desktop/ui/src/themePresetData.ts`。断言内置在脚本中（每组 24 键齐全、无空值），失败会抛错。

- [ ] **Step 2: 检查生成文件**

读取 `codex-desktop/ui/src/themePresetData.ts`，确认：
- 6 个主题键 `modern-minimal / clean-slate / amber-minimal / corporate / graphite / mono`，各含 `light`/`dark` 两组、每组 24 个 token。
- 每个主题的 `destructive-foreground` 为 fallback（light `#ffffff`、dark `#1a1c1f`）。
- 唯一例外：`modern-minimal.dark["sidebar-border"]` 保持 `"oklch(1.00 0 0 / 10%)"`。
- 其余值均为 6 位 hex（小写）。

（脚本全文，备查——若文件缺失按此重建：）

```js
// oklch-to-hex.mjs
import { readFileSync, writeFileSync } from "node:fs";
const SOURCE = "C:/Users/sekfung/RustroverProjects/codex/.superpowers/sdd/2026-08-17-custom-theme/minimal-themes-source.json";
const OUT = "C:/Users/sekfung/RustroverProjects/codex/codex-desktop/ui/src/themePresetData.ts";
const THEME_TOKEN_KEYS = ["background","foreground","card","card-foreground","popover","popover-foreground","primary","primary-foreground","secondary","secondary-foreground","muted","muted-foreground","accent","accent-foreground","destructive","destructive-foreground","border","input","ring","sidebar","sidebar-foreground","sidebar-accent","sidebar-accent-foreground","sidebar-border"];
const FALLBACK = { light: { "destructive-foreground": "#ffffff" }, dark: { "destructive-foreground": "#1a1c1f" } };
function oklchToHex(oklch) {
  const m = oklch.match(/^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/);
  if (!m) throw new Error("bad oklch: " + oklch);
  const L = +m[1], C = +m[2], H = (+m[3] * Math.PI) / 180;
  const a = C * Math.cos(H), b = C * Math.sin(H);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, mm = m_ ** 3, s = s_ ** 3;
  const X = 1.2270138511 * l - 0.5577999806 * mm + 0.281256149 * s;
  const Y = -0.0405801784 * l + 1.1122568696 * mm - 0.0716766787 * s;
  const Z = -0.0763812845 * l - 0.4214819784 * mm + 1.5861632204 * s;
  let r = 3.2409699419 * X - 1.5373831776 * Y - 0.4986107603 * Z;
  let g = -0.9692436363 * X + 1.8759675015 * Y + 0.0415550574 * Z;
  let bl = 0.0556300797 * X - 0.2039769589 * Y + 1.0569715142 * Z;
  const gamma = (c) => { c = Math.min(1, Math.max(0, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; };
  r = gamma(r); g = gamma(g); bl = gamma(bl);
  const to8 = (c) => Math.round(c * 255).toString(16).padStart(2, "0");
  return "#" + to8(r) + to8(g) + to8(bl);
}
const data = JSON.parse(readFileSync(SOURCE, "utf8"));
const out = {};
for (const [themeName, modes] of Object.entries(data)) {
  out[themeName] = {};
  for (const mode of ["light", "dark"]) {
    const tokens = {};
    for (const key of THEME_TOKEN_KEYS) {
      const raw = modes[mode][`--${key}`];
      if (raw === undefined) {
        const fallback = FALLBACK[mode][key];
        if (!fallback) throw new Error(`missing ${themeName} ${mode} ${key} and no fallback`);
        tokens[key] = fallback;
      } else if (raw.includes("/")) {
        tokens[key] = raw;
      } else {
        tokens[key] = oklchToHex(raw);
      }
    }
    out[themeName][mode] = tokens;
  }
}
for (const [themeName, modes] of Object.entries(out)) {
  for (const mode of ["light", "dark"]) {
    for (const key of THEME_TOKEN_KEYS) {
      const value = out[themeName][mode][key];
      if (typeof value !== "string" || value.length === 0) throw new Error(`empty ${themeName} ${mode} ${key}`);
    }
  }
}
const ts = `// GENERATED by .superpowers/sdd/2026-08-17-custom-theme/oklch-to-hex.mjs from\n// minimal-themes-source.json (shadcn.io Minimal series themes, oklch values\n// provided by the user). Do not edit by hand; regenerate with the script.\n// Values are 6-digit hex; the single alpha token (modern-minimal dark\n// sidebar-border) stays oklch verbatim.\nimport type { PaletteMode, ThemeKey, ThemeTokenKey } from "./themeTokens";\n\nexport const PRESET_PALETTES: Record<Exclude<ThemeKey, "default">, Record<PaletteMode, Record<ThemeTokenKey, string>>> = ${JSON.stringify(out, null, 2)};\n`;
writeFileSync(OUT, ts, "utf8");
console.log("wrote", OUT);
```

- [ ] **Step 3: 修改 `themeTokens.ts` 加主题键类型与模型字段**

在 `PaletteMode` 类型定义（第 117 行附近）之后加入：

```ts
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
```

`ThemeCustomization` 接口（约第 238 行）加字段：

```ts
export interface ThemeCustomization {
  theme: ThemeKey;
  font: FontKey;
  light: ModePalette;
  dark: ModePalette;
}
```

`emptyCustomization()`（约第 244 行）改为：

```ts
export function emptyCustomization(): ThemeCustomization {
  return { theme: "default", font: "system", light: { tokens: {} }, dark: { tokens: {} } };
}
```

`normalizeCustomization()`（约第 248 行）改为：

```ts
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
```

- [ ] **Step 4: 新建 `themePresets.ts`（本任务不含 effectivePalette）**

```ts
// 预设主题元数据与基准调色板（shadcn.io Minimal 系列，色值见 themePresetData.ts）。
// basePalette 提供"基准"色板；effectivePalette 在其上叠加用户微调
// （ADR-0009、spec 2026-08-17-theme-presets-design.md）。
import { DEFAULT_PALETTE } from "./themeTokens";
import type { PaletteMode, ThemeKey, ThemeTokenKey } from "./themeTokens";
import { PRESET_PALETTES } from "./themePresetData";

export interface ThemePreset {
  key: ThemeKey;
  label: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { key: "default", label: "默认" },
  { key: "modern-minimal", label: "现代极简" },
  { key: "clean-slate", label: "净白" },
  { key: "amber-minimal", label: "琥珀暖调" },
  { key: "corporate", label: "商务" },
  { key: "graphite", label: "石墨" },
  { key: "mono", label: "单色" },
];

export function basePalette(mode: PaletteMode, theme: ThemeKey): Record<ThemeTokenKey, string> {
  return theme === "default" ? DEFAULT_PALETTE[mode] : PRESET_PALETTES[theme][mode];
}
```

- [ ] **Step 5: 构建验证**

运行：`pnpm build`（workdir `codex-desktop/ui`）
Expected: PASS（`tsc --noEmit && vite build` 均通过）。本任务不动调用点，`effectivePalette` 旧签名仍留在 `themeTokens.ts`，功能尚不可见。

- [ ] **Step 6: 提交**

```bash
git add codex-desktop/ui/src/themeTokens.ts codex-desktop/ui/src/themePresets.ts codex-desktop/ui/src/themePresetData.ts
git commit -m "feat(desktop): add preset theme palette data and theme key model"
```

---

### Task 2: 基准 + 微调的合并逻辑与全量渲染

**Files:**
- Modify: `codex-desktop/ui/src/themePresets.ts`（加 `effectivePalette`）
- Modify: `codex-desktop/ui/src/themeTokens.ts`（移除 `effectivePalette`）
- Modify: `codex-desktop/ui/src/useTheme.ts`（`applyTheme` 全量写 24 值）
- Modify: `codex-desktop/ui/src/components/settings/ThemeTokenEditor.tsx`（新签名 + 重置目标改为当前基准）
- Modify: `codex-desktop/ui/src/components/settings/AppearanceSettings.tsx`（新签名）
- Modify: `codex-desktop/ui/src/components/settings/ColorControl.tsx`（取色器非 hex 兜底）

**Interfaces:**
- Consumes: `basePalette(mode, theme)`、`THEME_TOKEN_KEYS`、`ThemeCustomization`、`ThemeKey`。
- Produces: `effectivePalette(mode: PaletteMode, customization: ThemeCustomization): Record<ThemeTokenKey, string>`（`themePresets.ts` 导出）。

- [ ] **Step 1: `themePresets.ts` 增加 effectivePalette**

在 `basePalette` 之后追加：

```ts
export function effectivePalette(
  mode: PaletteMode,
  customization: ThemeCustomization,
): Record<ThemeTokenKey, string> {
  const palette = { ...basePalette(mode, customization.theme) };
  for (const key of THEME_TOKEN_KEYS) {
    const value = customization[mode].tokens[key];
    if (value) palette[key] = value;
  }
  return palette;
}
```

相应把 import 改为：

```ts
import { DEFAULT_PALETTE, THEME_TOKEN_KEYS } from "./themeTokens";
import type { PaletteMode, ThemeCustomization, ThemeKey, ThemeTokenKey } from "./themeTokens";
import { PRESET_PALETTES } from "./themePresetData";
```

- [ ] **Step 2: 从 `themeTokens.ts` 移除旧的 `effectivePalette`**

删除 `themeTokens.ts` 中 `effectivePalette` 函数（约第 177-184 行）。若 `THEME_TOKEN_KEYS` 仅被该函数引用则同时核对其它引用，保留定义（`applyTheme` 仍在用）。旧签名调用点本任务同步更新。

- [ ] **Step 3: `useTheme.ts` 的 applyTheme 改为全量写 24 值**

`applyTheme`（约第 36-48 行）改为：

```ts
function applyTheme(resolved: PaletteMode, customization: ThemeCustomization) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  // Kept in sync so native form controls, scrollbars and the webview's own
  // canvas follow the theme too — CSS `color-scheme` reads this.
  document.documentElement.style.colorScheme = resolved;
  const palette = effectivePalette(resolved, customization);
  for (const key of THEME_TOKEN_KEYS) {
    document.documentElement.style.setProperty(`--${key}`, palette[key]);
  }
  document.documentElement.style.setProperty("--font-sans", fontFamily(customization.font));
}
```

（原来只写有覆盖的键并 `removeProperty` 的逻辑删除——现在基准也要内联写入。）

import 增加：`import { effectivePalette } from "./themePresets";`

- [ ] **Step 4: `ThemeTokenEditor.tsx` 改新签名与重置目标**

import 改为：

```ts
import { TOKEN_GROUPS } from "../../themeTokens";
import type { PaletteMode, ThemeCustomization, ThemeTokenKey } from "../../themeTokens";
import { basePalette, effectivePalette } from "../../themePresets";
```

第 23 行 `const palette = effectivePalette(mode, customization[mode].tokens);` 改为：

```ts
const palette = effectivePalette(mode, customization);
```

第 62 行 `defaultValue={DEFAULT_PALETTE[mode][key]}` 改为：

```ts
defaultValue={basePalette(mode, customization.theme)[key]}
```

- [ ] **Step 5: `AppearanceSettings.tsx` 改新签名**

import 改为：

```ts
import { FONTS } from "../../themeTokens";
import type { PaletteMode, ThemeTokenKey } from "../../themeTokens";
import { effectivePalette } from "../../themePresets";
```

第 28-29 行改为：

```ts
    light: effectivePalette("light", customization),
    dark: effectivePalette("dark", customization),
```

- [ ] **Step 6: `ColorControl.tsx` 取色器非 hex 兜底**

`HexColorPicker` 只接受 hex；预设中唯一 alpha token（`modern-minimal` 深色 `sidebar-border` = `oklch(1 0 0 / 10%)`）作为基准值时不是 hex。在组件体内（`const [draft, setDraft] = useState(value);` 之后）加：

```ts
  // Preset bases are hex; the single alpha token is oklch, which
  // react-colorful's HexColorPicker cannot parse — fall back to black.
  const pickerColor = isHexColor(value) ? value : "#000000";
```

第 74 行 `color={value}` 改为 `color={pickerColor}`。其余（色块 `backgroundColor`、hex 输入显示）不变——hex 输入对非 hex 值仅显示，提交仍需 `isHexColor` 通过。

- [ ] **Step 7: 构建验证**

运行：`pnpm build`（workdir `codex-desktop/ui`）
Expected: PASS。此时 `customization.theme` 生效于 `effectivePalette`/`applyTheme`，但尚无 `setTheme` 入口，UI 未暴露。

- [ ] **Step 8: 提交**

```bash
git add codex-desktop/ui/src/themePresets.ts codex-desktop/ui/src/themeTokens.ts codex-desktop/ui/src/useTheme.ts codex-desktop/ui/src/components/settings/ThemeTokenEditor.tsx codex-desktop/ui/src/components/settings/AppearanceSettings.tsx codex-desktop/ui/src/components/settings/ColorControl.tsx
git commit -m "feat(desktop): apply preset base palette with per-token overrides"
```

---

### Task 3: 主题切换状态接线

**Files:**
- Modify: `codex-desktop/ui/src/useTheme.ts`

**Interfaces:**
- Consumes: `ThemeKey`（`themeTokens.ts`）。
- Produces: `ThemeValue.setTheme: (theme: ThemeKey) => void`。

- [ ] **Step 1: `ThemeValue` 接口加 setTheme**

`ThemeValue` 接口（约第 50-62 行）在 `setFont` 后加：

```ts
  setTheme: (theme: ThemeKey) => void;
```

import 补：`import type { FontKey, PaletteMode, ThemeCustomization, ThemeKey, ThemeTokenKey } from "./themeTokens";`

- [ ] **Step 2: 实现 setTheme**

在 `setFont` useCallback（约第 113-115 行）之后加：

```ts
  const setTheme = useCallback((theme: ThemeKey) => {
    setCustomization((prev) => ({ ...prev, theme }));
  }, []);
```

- [ ] **Step 3: 挂入 value memo**

`value` 的 `useMemo`（约第 117-128 行）对象中加 `setTheme`，并把 `setTheme` 加入依赖数组：

```ts
  const value = useMemo<ThemeValue>(
    () => ({
      mode,
      setMode,
      resolved: mode === "system" ? (systemDark ? "dark" : "light") : mode,
      customization,
      setToken,
      resetModeTokens,
      setFont,
      setTheme,
    }),
    [mode, systemDark, customization, setToken, resetModeTokens, setFont, setTheme],
  );
```

- [ ] **Step 4: 构建验证**

运行：`pnpm build`（workdir `codex-desktop/ui`）
Expected: PASS（未用导出不报错；`setTheme` 尚无 UI 消费者）。

- [ ] **Step 5: 提交**

```bash
git add codex-desktop/ui/src/useTheme.ts
git commit -m "feat(desktop): expose setTheme in theme context"
```

---

### Task 4: 预设主题 chip 区 UI

**Files:**
- Modify: `codex-desktop/ui/src/components/settings/AppearanceSettings.tsx`

**Interfaces:**
- Consumes: `useTheme().customization.theme`、`useTheme().setTheme`、`THEME_PRESETS`、`PRESET_PALETTES`、`DEFAULT_PALETTE`、`cn`。
- Produces: 「预设主题」`SettingsSection`（默认 + 6 预设 chip 网格）。

- [ ] **Step 1: 取 setTheme 并补 import**

组件内 `useTheme()` 解构（第 26 行）改为：

```ts
  const { mode, setMode, customization, setToken, resetModeTokens, setFont, setTheme } = useTheme();
```

import 改为：

```ts
import { Check } from "lucide-react";

import { useTheme } from "../../useTheme";
import type { ThemeMode } from "../../useTheme";
import { DEFAULT_PALETTE, FONTS } from "../../themeTokens";
import type { PaletteMode, ThemeTokenKey } from "../../themeTokens";
import { PRESET_PALETTES } from "../../themePresetData";
import { THEME_PRESETS, effectivePalette } from "../../themePresets";
import { SettingsHeader, SettingsSection, SettingRow } from "./SettingsPrimitives";
import { ThemeTokenEditor } from "./ThemeTokenEditor";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
```

- [ ] **Step 2: 在「主题」与「自定义」区之间插入「预设主题」区**

在 `</SettingsSection>`（「主题」区结束，约第 72 行）与 `<SettingsSection title="自定义">`（第 74 行）之间插入：

```tsx
      <SettingsSection title="预设主题">
        <div className="grid grid-cols-4 gap-3 px-4 py-3.5">
          {THEME_PRESETS.map((preset) => {
            const active = customization.theme === preset.key;
            const swatch =
              preset.key === "default"
                ? { light: DEFAULT_PALETTE.light.background, dark: DEFAULT_PALETTE.dark.background }
                : {
                    light: PRESET_PALETTES[preset.key].light.background,
                    dark: PRESET_PALETTES[preset.key].dark.background,
                  };
            return (
              <button
                key={preset.key}
                type="button"
                aria-pressed={active}
                onClick={() => setTheme(preset.key)}
                className="group flex flex-col gap-1.5"
              >
                <span
                  className={cn(
                    "flex h-10 w-full overflow-hidden rounded-lg border-2 transition-colors",
                    active ? "border-primary" : "border-border group-hover:border-muted-foreground/40",
                  )}
                >
                  <span className="w-1/2" style={{ backgroundColor: swatch.light }} />
                  <span className="w-1/2" style={{ backgroundColor: swatch.dark }} />
                </span>
                <span className={cn("text-center text-xs", active ? "font-medium" : "text-muted-foreground")}>
                  {preset.label}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsSection>
```

- [ ] **Step 3: 构建验证**

运行：`pnpm build`（workdir `codex-desktop/ui`）
Expected: PASS。功能完整：切预设即改基准、微调叠加、恢复默认回落当前基准、预览卡反映预设。

- [ ] **Step 4: 提交**

```bash
git add codex-desktop/ui/src/components/settings/AppearanceSettings.tsx
git commit -m "feat(desktop): add preset theme picker to appearance settings"
```

- [ ] **Step 5: 手动冒烟检查（用户执行）**

运行 Tauri 应用（构建门槛无法覆盖运行时行为），核对：
1. 预设 chip 切换即时生效；「默认」chip 回到内置主题。
2. 在预设 A 下微调某 token → 切到预设 B → 该微调保留（delta 叠加）。
3. 恢复默认回落当前基准（预设 B 的色值，而非内置默认）。
4. `modern-minimal` 深色下 `sidebar-border` 为半透明白（alpha 例外正常），其取色器不崩溃。
5. 重启应用后所选预设保留；老存档（无 `theme` 字段）打开默认主题不报错。

---

## Amendment

- **Task 4 Step 1 导入来源错误（实施时修正）**：计划原文写 `import { PRESET_PALETTES, THEME_PRESETS, effectivePalette } from "../../themePresets";`，但 `PRESET_PALETTES` 由 `themePresetData.ts` 导出（`themePresets.ts` 仅 import 未 re-export）。实现者按设计（spec 2026-08-17-theme-presets-design.md 数据放 themePresetData.ts）修正为 `PRESET_PALETTES` 从 `../../themePresetData` 导入、`THEME_PRESETS`/`effectivePalette` 从 `../../themePresets` 导入，其余代码逐字保留。已提交 `6066f1997`。

- **Task 4 UI 形式变更（用户要求，已提交 `fad885aac`）**：用户反馈 chip 网格排版不佳，改为下拉选择框形式。实现：共享 `Select` 组件 `SelectOption` 增可选 `swatch?: { light; dark }` 字段（纯增量，触发器与每个选项渲染双色小色板，现有调用方不受影响）；「预设主题」区由 chip 网格改为 `SettingRow + Select`，选项色板经 `basePalette("light"/"dark", key).background` 计算（顺带消除原 chip 实现中与 `basePalette` 重复的取色逻辑）。