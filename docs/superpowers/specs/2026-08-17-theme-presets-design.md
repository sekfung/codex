# 预设主题一键切换 Design

**日期：** 2026-08-17
**状态：** 已确认

## 背景与目标

Codex Desktop 外观设置已支持逐 token 自定义颜色（浅/深各自独立）与预设字体栈（ADR-0009，见 `2026-08-17-custom-theme-design.md`）。本设计在其之上增加**预设主题一键切换**：内置 shadcn.io 的 Minimal 系列 6 个主题（Modern Minimal / Clean Slate / Amber Minimal / Corporate / Graphite / Mono）为可选的「基准主题」，用户仍可在其上逐 token 微调。

## 已确认决策

- **预设做底 + 微调叠加**：切换预设不丢弃已有手动微调；手动改过的 token 作为增量叠加在新基准上，未改过的跟随新基准。
- **UI 形式**：chip 卡片网格 + 双色预览。
- **数据来源**：用户提供 6 个主题的 `:root`/`.dark` oklch 值（已存 `.superpowers/sdd/2026-08-17-custom-theme/minimal-themes-source.json`）。
- **色值格式**：设计期转 hex 常量（oklch→sRGB），与现有 hex 管线（`isHexColor`、`normalizeCustomization`、`HexColorPicker`）零冲突。唯一例外：Modern Minimal 深色 `--sidebar-border: oklch(1.00 0 0 / 10%)`（带 alpha）保留原样 oklch 字符串。

## 数据模型（`codex-desktop/ui/src/themeTokens.ts`）

- 新增类型与常量：
  - `ThemeKey = "default" | "modern-minimal" | "clean-slate" | "amber-minimal" | "corporate" | "graphite" | "mono"`
  - `interface ThemePreset { key: ThemeKey; label: string }`
  - `THEME_PRESETS: ThemePreset[]`，首项为 `{ key: "default", label: "默认" }`，其余 6 项中文标签：现代极简 / 净白 / 琥珀暖调 / 商务 / 石墨 / 单色。
  - `PRESET_PALETTES: Record<Exclude<ThemeKey, "default">, Record<PaletteMode, Record<ThemeTokenKey, string>>>`：6 个预设 × 浅/深 × 全部 24 个 token 的 hex 常量。
    - 数据映射规则：以 `minimal-themes-source.json` 为准，只取 `THEME_TOKEN_KEYS` 中的 24 个键；源数据缺失的键（各预设均缺 `destructive-foreground`）用 `DEFAULT_PALETTE` 对应值补齐，保证每组完整。
    - 转换方式：设计/实现期用一次性 node 脚本做 oklch→sRGB→hex（8bit 舍入），脚本与断言放在 SDD 工作区，不进入运行时代码。
    - 例外：`modern-minimal` 深色 `sidebar-border` 保留 `oklch(1 0 0 / 10%)` 原样（非 hex 是允许的——预设常量是代码常量，绕过 `isHexColor`，仅用户手输的 overrides 走 hex 校验）。
- 新增/调整函数：
  - `basePalette(mode: PaletteMode, theme: ThemeKey): Record<ThemeTokenKey, string>`：`"default"` 返回 `DEFAULT_PALETTE[mode]`，否则返回 `PRESET_PALETTES[theme][mode]`。
  - `effectivePalette(mode: PaletteMode, customization: ThemeCustomization): Record<ThemeTokenKey, string>`：**签名从 `(mode, overrides)` 改为 `(mode, customization)`**，内部 = `basePalette(mode, customization.theme)` 逐键叠加 `customization[mode].tokens` 覆盖。

## 状态与持久化（`codex-desktop/ui/src/useTheme.ts`）

- `ThemeCustomization` 增加字段 `theme: ThemeKey`。
- `emptyCustomization()`：`{ theme: "default", font: "system", light: {tokens:{}}, dark: {tokens:{}} }`。
- `normalizeCustomization(raw)`：校验 `obj.theme` 是否为 `THEME_PRESETS` 中的 key，非法或缺失一律回退 `"default"`。旧数据（无 `theme` 字段）自动兼容。
- `applyTheme(resolved, customization)`：对 `THEME_TOKEN_KEYS` 全部 24 键计算 `effectivePalette(resolved, customization)[key]` 并全部写入内联 CSS 变量（不再只写有覆盖的键）；默认主题下内联值等于 CSS `:root`/`.dark` 默认，视觉不变。`--font-sans` 逻辑不变。
- 新增 `setTheme(theme: ThemeKey)`（不可变更新，`useCallback`），context `ThemeValue` 暴露 `setTheme`。
- 无新增 localStorage key；`theme` 存于现有 `codex-desktop-theme-customization` JSON。

## UI（`codex-desktop/ui/src/components/settings/AppearanceSettings.tsx`）

- 在「主题」区与「自定义」区之间新增 `SettingsSection`「预设主题」：
  - chip 网格，首项「默认」+ 6 个预设；每项一个圆角块：左右两半分别显示该主题浅/深模式的 `background`（双色预览）+ 下方名称。
  - 当前基准主题高亮（`border-primary`）；点击调用 `setTheme`。
  - chip 预览色板来自 `PRESET_PALETTES`（静态，不随微调变化）。
- 三张预览卡（系统/浅色/深色）改用新签名 `effectivePalette(mode, customization)`，自动反映预设 + 微调。
- 「恢复默认」按钮语义不变：清空该模式 overrides，回落当前基准主题。

## 依赖组件调整

- `ColorControl`：调用方传入的 `defaultValue`（重置目标）改为 `basePalette(mode, customization.theme)[token]`；`overridden` 判定不变（`customization[mode].tokens` 是否存在）。`isHexColor` 校验仅作用于用户输入，预设基准为 hex 常量（唯一 alpha 例外显示为 oklch 字符串，该 token 在 `modern-minimal` 深色下由恢复默认提供）。
- `ThemeTokenEditor`：`恢复默认` 目标改为当前基准；行内「默认值」展示为当前基准值。

## 边界

- 预设只影响 24 个颜色 token；不改变 `--radius`、`--chart-*`、字体（字体仍走独立 `FONTS` 选择）。
- `--sidebar-primary`、`--sidebar-primary-foreground`、`--sidebar-ring` 不在 `THEME_TOKEN_KEYS` 内，忽略（本应用 CSS 未定义它们）。
- 切换预设保留手动微调（delta）；「默认」chip 回到内置 `DEFAULT_PALETTE`。
- 不触碰 Rust 代码与 `codex-rs/` 其它内容。

## 验证

- 转换脚本断言：每组预设产出后 24 键齐全（含 fallback），无空值。
- 构建门槛：`cd codex-desktop/ui && pnpm build`（`tsc --noEmit && vite build`）。
- 手动冒烟检查：预设切换即时生效、微调在切预设后保留、恢复默认回落当前基准、「默认」chip 回到内置主题、重启保留、跟随系统解析正确。