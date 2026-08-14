import { Check } from "lucide-react";

import { useTheme } from "../../useTheme";
import type { ThemeMode } from "../../useTheme";
import { SettingsHeader, SettingsSection } from "./SettingsPrimitives";
import { cn } from "@/lib/utils";

// Follows reference screenshot 03's three preview cards — but *only* those.
// ADR-0009 defers the per-token theme editor (accent/background/foreground
// rows, the theme-diff view, font picker) to v2, so it is deliberately absent
// rather than stubbed.
//
// Theme mode stays in `localStorage` via `useTheme`, not `config.toml`: it is
// desktop chrome, and the CLI has no use for it (ADR-0020).

const THEMES: { mode: ThemeMode; label: string }[] = [
  { mode: "system", label: "系统" },
  { mode: "light", label: "浅色" },
  { mode: "dark", label: "深色" },
];

export function AppearanceSettings() {
  const { mode, setMode } = useTheme();

  return (
    <>
      <SettingsHeader title="外观" />

      <section className="mb-8">
        <h2 className="mb-2.5 text-sm font-medium">主题</h2>
        <div className="grid grid-cols-3 gap-4">
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
                <ThemePreview mode={theme.mode} />
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
      </section>

      <SettingsSection title="自定义">
        <div className="px-4 py-3.5 text-xs leading-5 text-muted-foreground">
          自定义主题色与字体计划在后续版本提供（ADR-0009）。当前版本仅支持浅色 / 深色 / 跟随系统。
        </div>
      </SettingsSection>
    </>
  );
}

/// A miniature of the app's own two-pane layout. Painted with literal light
/// and dark values rather than theme tokens, because each card must show what
/// that theme looks like regardless of the theme currently in force — the
/// "系统" card deliberately shows both halves at once.
function ThemePreview({ mode }: { mode: ThemeMode }) {
  if (mode === "system") {
    return (
      <div className="flex size-full">
        <div className="w-1/2 overflow-hidden">
          <PreviewPane dark={false} />
        </div>
        <div className="w-1/2 overflow-hidden">
          <PreviewPane dark />
        </div>
      </div>
    );
  }
  return <PreviewPane dark={mode === "dark"} />;
}

function PreviewPane({ dark }: { dark: boolean }) {
  const bg = dark ? "#1a1c1f" : "#ffffff";
  const rail = dark ? "#141619" : "#f9f9f8";
  const line = dark ? "#2b2f34" : "#e7e7e5";
  const block = dark ? "#24272b" : "#f0f0ef";

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
