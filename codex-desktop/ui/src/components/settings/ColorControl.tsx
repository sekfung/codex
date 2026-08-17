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
