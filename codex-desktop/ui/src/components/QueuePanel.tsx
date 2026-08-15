import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Paperclip, Play, X } from "lucide-react";

import { useStore } from "../store";
import { Button } from "@/components/ui/button";

/**
 * Submissions waiting behind the running turn (`thread/queue/*`).
 *
 * This is a *view* of engine state, not a schedule this client executes.
 * `QueuedItemService` implements `on_thread_idle` and dispatches the head of
 * the queue itself whenever the thread goes idle for any cause except an
 * interrupt (`ext/queue/src/service.rs`), so nothing here starts queued work
 * on turn completion — that would race the engine and could run a submission
 * twice.
 *
 * The one exception is the "现在开始" button, which appears only while the
 * thread is idle. That is exactly the case the engine skips: an interrupted
 * turn suppresses auto-dispatch, leaving the queue parked until asked for.
 */
export function QueuePanel({ threadId }: { threadId: string }) {
  const { state, refetchQueue, removeQueued, moveQueued, startQueuedNow } = useStore();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const thread = state.threads[threadId];
  const queue = thread?.queue ?? [];
  const activeTurnId = thread?.activeTurnId ?? null;
  const turnRunning = activeTurnId !== null && thread?.turnStatus[activeTurnId] === "inProgress";

  // A queue set before this window attached is only discoverable by asking;
  // `thread/queue/changed` keeps it current from then on.
  useEffect(() => {
    refetchQueue(threadId).catch(() => {
      /* an empty queue and an unreadable one look the same to the user here */
    });
  }, [threadId, refetchQueue]);

  if (queue.length === 0) return null;

  async function run(id: string, action: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mb-2 rounded-xl border border-border bg-muted/40 p-2">
      <div className="flex items-center gap-2 px-1 pb-1.5 text-xs text-muted-foreground">
        <span>队列（{queue.length}）</span>
        <span className="flex-1" />
        {turnRunning ? (
          <span>当前回合结束后自动执行</span>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            disabled={busyId !== null}
            onClick={() => void run(queue[0].id, () => startQueuedNow(threadId))}
          >
            <Play className="size-3" />
            现在开始
          </Button>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {queue.map((entry, index) => (
          <li
            key={entry.id}
            className="flex items-start gap-2 rounded-lg bg-background/60 px-2 py-1.5"
          >
            <span className="mt-0.5 w-4 shrink-0 text-center text-xs text-muted-foreground">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{entry.text || "（无文本）"}</span>
              {(entry.attachmentCount > 0 || entry.skillNames.length > 0) && (
                <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  {entry.attachmentCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Paperclip className="size-3" />
                      {entry.attachmentCount}
                    </span>
                  )}
                  {entry.skillNames.map((name) => (
                    <span key={name}>${name}</span>
                  ))}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="上移"
                disabled={index === 0 || busyId !== null}
                onClick={() => void run(entry.id, () => moveQueued(threadId, entry.id, -1))}
              >
                <ChevronUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="下移"
                disabled={index === queue.length - 1 || busyId !== null}
                onClick={() => void run(entry.id, () => moveQueued(threadId, entry.id, 1))}
              >
                <ChevronDown />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="移除"
                disabled={busyId !== null}
                onClick={() => void run(entry.id, () => removeQueued(threadId, entry.id))}
              >
                {busyId === entry.id ? <Loader2 className="animate-spin" /> : <X />}
              </Button>
            </span>
          </li>
        ))}
      </ul>

      {error && <div className="px-1 pt-1.5 text-xs text-destructive">{error}</div>}
    </div>
  );
}
