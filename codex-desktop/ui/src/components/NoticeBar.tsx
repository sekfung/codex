import { AlertTriangle, Info, OctagonAlert, X } from "lucide-react";

import { useStore } from "../store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Server-pushed notices: `warning`, `error`, `guardianWarning`,
 * `configWarning`, `deprecationNotice`, `model/rerouted`.
 *
 * Every one of these was previously discarded by the store, so a malformed
 * config or a silently substituted model produced no visible sign whatsoever.
 * They sit above the composer rather than in the message stream because they
 * are not part of the conversation — several arrive with no thread at all.
 */
export function NoticeBar() {
  const { state, dispatch } = useStore();
  if (state.notices.length === 0) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-6 pb-2">
      {state.notices.map((notice) => {
        const Icon =
          notice.severity === "error"
            ? OctagonAlert
            : notice.severity === "warning"
              ? AlertTriangle
              : Info;
        return (
          <div
            key={notice.id}
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]",
              notice.severity === "error"
                ? "border-destructive/30 bg-destructive/10"
                : notice.severity === "warning"
                  ? "border-amber-500/30 bg-amber-500/10"
                  : "border-border bg-muted/50",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                notice.severity === "error"
                  ? "text-destructive"
                  : notice.severity === "warning"
                    ? "text-amber-600 dark:text-amber-500"
                    : "text-muted-foreground",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="break-words">{notice.message}</div>
              {notice.details && (
                <div className="mt-0.5 break-words text-xs text-muted-foreground">
                  {notice.details}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="忽略"
              className="shrink-0 text-muted-foreground"
              onClick={() => dispatch({ type: "NOTICE_DISMISSED", id: notice.id })}
            >
              <X />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
