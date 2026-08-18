import { useEffect, useState } from "react";
import { Loader2, TerminalSquare } from "lucide-react";

import { useStore } from "../store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Processes the agent started and left running
 * (`thread/backgroundTerminals/list`), with terminate and clean.
 *
 * The TUI exposes only the clean-all half of this capability
 * (`AppCommand::CleanBackgroundTerminals`); `list` and `terminate` are
 * implemented server-side but nothing in-tree calls them. Without a list, a
 * dev server still holding a port after a turn ends is invisible — which is
 * the reason to surface it at all.
 */
export function BackgroundTerminals({ threadId }: { threadId: string }) {
  const { state, refetchBackgroundTerminals, terminateBackgroundTerminal, cleanBackgroundTerminals } =
    useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Two-step confirm, matching the sidebar's thread delete: killing someone's
   * dev server is not an undoable click.
   */
  const [confirming, setConfirming] = useState<string | null>(null);

  const terminals = state.threads[threadId]?.backgroundTerminals ?? [];

  // There is no notification for background terminals, so this refreshes on
  // open rather than pretending a stale list is live.
  useEffect(() => {
    if (!open) return;
    setConfirming(null);
    refetchBackgroundTerminals(threadId).catch((err) => setError(String(err)));
  }, [open, threadId, refetchBackgroundTerminals]);

  // Fetch once per thread so the trigger can reflect a non-empty list without
  // the user having to look first.
  useEffect(() => {
    refetchBackgroundTerminals(threadId).catch(() => {
      /* the trigger simply stays hidden if this fails */
    });
  }, [threadId, refetchBackgroundTerminals]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirming(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  if (terminals.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="gap-1.5 text-muted-foreground"
          title="后台进程"
        >
          <TerminalSquare className="size-3.5" />
          {terminals.length}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <span>后台进程</span>
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => void run(() => cleanBackgroundTerminals(threadId))}
          >
            全部清理
          </Button>
        </div>

        <ul className="flex flex-col gap-0.5">
          {terminals.map((terminal) => (
            <li key={terminal.processId} className="rounded-lg px-2 py-1.5 hover:bg-accent/60">
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">{terminal.command}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {terminal.cwd}
                    {terminal.osPid != null && ` · pid ${terminal.osPid}`}
                    {terminal.cpuPercent != null && ` · ${terminal.cpuPercent.toFixed(0)}% CPU`}
                    {terminal.rssKb != null && ` · ${Math.round(terminal.rssKb / 1024)} MB`}
                  </span>
                </span>
                {confirming === terminal.processId ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() =>
                        void run(() => terminateBackgroundTerminal(threadId, terminal.processId))
                      }
                    >
                      {busy ? <Loader2 className="animate-spin" /> : null}
                      确认终止
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => setConfirming(null)}>
                      取消
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="shrink-0"
                    disabled={busy}
                    onClick={() => setConfirming(terminal.processId)}
                  >
                    终止
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>

        {error && <div className="px-2 pt-1.5 text-xs text-destructive">{error}</div>}
      </PopoverContent>
    </Popover>
  );
}
