import { ArrowLeft, Bot, ScanSearch } from "lucide-react";

import { useStore } from "../store";
import { Button } from "@/components/ui/button";

/**
 * The way back out of a thread the sidebar cannot list.
 *
 * Sub-agent and detached-review threads are excluded from `thread/list` by the
 * protocol's `sourceKinds` default (ADR-0017), so once the main pane shows one
 * there is no row to click to return. Without this bar the only escape is
 * selecting an unrelated thread, which loses the user's place — a dead end
 * that the detached-review path already had before drill-in existed.
 */
export function ThreadTrailBar() {
  const { state, leaveThread } = useStore();
  const entry = state.threadTrail.at(-1);
  if (!entry) return null;

  const Icon = entry.reason === "review" ? ScanSearch : Bot;
  const what =
    entry.reason === "review"
      ? "独立审查"
      : entry.label
        ? `子智能体 ${entry.label}`
        : "子智能体";

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-6 py-2">
      <Button
        variant="ghost"
        size="xs"
        className="gap-1.5 text-muted-foreground"
        onClick={() => void leaveThread()}
      >
        <ArrowLeft className="size-3.5" />
        返回
      </Button>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate text-[13px] text-muted-foreground">
        正在查看{what}的对话
        {state.threadTrail.length > 1 && `（第 ${state.threadTrail.length} 层）`}
      </span>
    </div>
  );
}
