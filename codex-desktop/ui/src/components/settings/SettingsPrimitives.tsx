import type { ReactNode } from "react";

import { useStore } from "../../store";
import { cn } from "@/lib/utils";

/// Layout primitives shared by the settings screens, so a control that is
/// genuinely wired and one that isn't are visibly different rather than
/// looking identical and silently doing nothing.

export function SettingsHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
    </header>
  );
}

export function SettingsSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {children}
      </div>
    </section>
  );
}

export function SettingRow({
  label,
  description,
  control,
  disabled,
  note,
}: {
  label: string;
  description?: ReactNode;
  control: ReactNode;
  disabled?: boolean;
  /// Short reason shown when a control is inert — never leave a dead control
  /// looking live.
  note?: string;
}) {
  return (
    <div className={cn("flex items-start gap-4 px-4 py-3.5", disabled && "opacity-60")}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        {description && (
          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</div>
        )}
        {note && <div className="mt-1 text-xs text-muted-foreground/80">{note}</div>}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}

/// Marks a value that a managed or project config layer pins, so the user
/// understands why their edit didn't stick. `origins` comes from
/// `config/read`; the user's own layer is the uninteresting case.
export function OriginNote({ keyPath }: { keyPath: string }) {
  const { state } = useStore();
  const origin = state.configOrigins[keyPath];
  if (!origin || origin.name === "user" || origin.name === "default") return null;
  return (
    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      来自 {origin.name} 配置层
    </span>
  );
}

/// Shown in place of controls while `config/read` hasn't resolved, so the
/// screens never render defaults that misrepresent the stored config.
export function ConfigPending() {
  return (
    <div className="rounded-xl border border-border px-4 py-6 text-center text-sm text-muted-foreground">
      正在读取 config.toml…
    </div>
  );
}
