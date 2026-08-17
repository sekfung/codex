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
