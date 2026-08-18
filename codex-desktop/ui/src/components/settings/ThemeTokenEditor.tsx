import { useState } from "react";
import { Check } from "lucide-react";

import { TOKEN_GROUPS } from "../../themeTokens";
import type { PaletteMode, ThemeCustomization, ThemeTokenKey } from "../../themeTokens";
import { basePalette, effectivePalette } from "../../themePresets";
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
  const palette = effectivePalette(mode, customization);

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
              defaultValue={basePalette(mode, customization.theme)[key]}
              overridden={customization[mode].tokens[key] !== undefined}
              onCommit={(hex) => setToken(mode, key, hex)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
