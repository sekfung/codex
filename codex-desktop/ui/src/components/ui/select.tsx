import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Built on the already-installed Popover rather than `@radix-ui/react-select`
// (not a dependency; see switch.tsx for why we're not adding one). The
// Official App's settings controls are dropdown *buttons* showing the current
// value — which is exactly a popover with a list, not a native <select>.

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /// Optional second line, used where a value's meaning isn't obvious from
  /// its label alone (reasoning efforts, web-search modes).
  hint?: string;
}

interface SelectProps<T extends string> {
  value: T | null;
  options: SelectOption<T>[];
  /// Optional so a `disabled` placeholder select — a setting this build shows
  /// but can't yet write — doesn't have to pass a no-op handler that would
  /// read as if it were wired up.
  onValueChange?: (value: T) => void;
  /// Shown when `value` is null or names an option that isn't in the list —
  /// e.g. a config written by the CLI that this build doesn't offer.
  placeholder?: string;
  disabled?: boolean;
  align?: "start" | "center" | "end";
  className?: string;
  contentClassName?: string;
  "aria-label"?: string;
}

export function Select<T extends string>({
  value,
  options,
  onValueChange,
  placeholder = "未设置",
  disabled,
  align = "end",
  className,
  contentClassName,
  "aria-label": ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            "inline-flex h-8 min-w-0 items-center justify-between gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[13px]",
            "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {/* An unrecognized value is shown verbatim rather than as the
                placeholder: silently displaying "未设置" for a value that *is*
                set would misreport the config actually in force. */}
            {selected?.label ?? (value ?? placeholder)}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className={cn("w-64", contentClassName)}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => {
              setOpen(false);
              onValueChange?.(option.value);
            }}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[13px]">{option.label}</span>
              {option.hint && (
                <span className="block text-xs leading-5 text-muted-foreground">{option.hint}</span>
              )}
            </span>
            {option.value === value && <Check className="mt-0.5 size-4 shrink-0" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
