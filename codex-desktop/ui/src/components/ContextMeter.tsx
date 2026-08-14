import { useState } from "react";
import { Loader2, Shrink } from "lucide-react";

import { useStore } from "../store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/// Context pressure, from `thread/tokenUsage/updated`.
///
/// The percentage itself is computed by the engine's own
/// `percent_of_context_window_remaining` via a Rust command — see
/// `src/composer.rs` for why it isn't arithmetic here.
///
/// Doubles as the entry point for `thread/compact/start`, because running low
/// on context is exactly when a user reaches for compaction (the TUI pairs
/// them the same way: `/compact` and the context footer).
export function ContextMeter({ threadId }: { threadId: string }) {
  const { state, compactThread } = useStore();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const thread = state.threads[threadId];
  const usage = thread?.contextUsage ?? null;
  const compacting = thread?.compacting ?? false;

  // A thread with no completed turn has no usage yet. Showing "100%" then
  // would be an invention — the engine hasn't reported anything.
  if (!usage && !compacting) return null;

  const percent = usage?.percentRemaining ?? null;
  // Below ~15% the window is close enough to full that it stops being
  // background information.
  const scarce = percent !== null && percent <= 15;

  async function handleCompact() {
    setOpen(false);
    setError(null);
    try {
      await compactThread(threadId);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={cn("gap-1.5 text-muted-foreground", scarce && "text-amber-600 dark:text-amber-500")}
          title="上下文用量"
        >
          {compacting ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              压缩中…
            </>
          ) : percent !== null ? (
            `剩余 ${percent}%`
          ) : (
            // No context window reported for this model, so a percentage
            // would be meaningless; the token count still is not.
            `${usage?.usedTokens.toLocaleString()} tokens`
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="mb-2 text-[13px] font-medium">上下文</div>
        {percent !== null && (
          <>
            <div className="mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", scarce ? "bg-amber-500" : "bg-primary")}
                style={{ width: `${100 - percent}%` }}
              />
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              剩余 {percent}%，已用约 {usage?.usedTokens.toLocaleString()} tokens
            </p>
          </>
        )}
        {percent === null && (
          <p className="mb-3 text-xs text-muted-foreground">
            该模型未报告上下文窗口大小，仅显示累计用量：
            {usage?.usedTokens.toLocaleString()} tokens
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          disabled={compacting}
          onClick={handleCompact}
        >
          {compacting ? <Loader2 className="animate-spin" /> : <Shrink />}
          {compacting ? "正在压缩对话…" : "压缩对话"}
        </Button>
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          压缩会让 Codex 总结此前的对话以腾出上下文，原始内容不再逐字保留。
        </p>
        {error && <p className="mt-2 text-xs text-destructive">压缩失败：{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
