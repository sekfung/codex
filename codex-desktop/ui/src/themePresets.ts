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