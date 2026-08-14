import * as React from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Built on the already-installed Popover, following the same reasoning as
// `select.tsx` and `switch.tsx`: `@radix-ui/react-dropdown-menu` isn't a
// dependency, and the pnpm workspace's `minimumReleaseAge`/trust policy makes
// adding one a heavier step than these controls earn.

export function Menu({
  trigger,
  align = "start",
  className,
  children,
  open,
  onOpenChange,
}: {
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(false);
  const isOpen = open ?? uncontrolled;
  const setOpen = onOpenChange ?? setUncontrolled;
  const close = React.useCallback(() => setOpen(false), [setOpen]);

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className={cn("w-52", className)}>
        {typeof children === "function" ? children(close) : children}
      </PopoverContent>
    </Popover>
  );
}

export function MenuItem({
  className,
  destructive,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { destructive?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]",
        "hover:bg-accent focus-visible:outline-none focus-visible:bg-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        destructive && "text-destructive hover:bg-destructive/10",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1.5 text-xs text-muted-foreground">{children}</div>;
}
