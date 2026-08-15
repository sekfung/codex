import { CircleAlert } from "lucide-react";

import { useStore } from "../store";
import { formatResetTime, usageExhausted } from "./AccountFooter";

/**
 * Informational-only quota notice above the composer.
 *
 * The Official App's equivalent banner carries "升级至 Pro" / "增加额度"
 * buttons; those are deliberately absent here — this app has no billing,
 * upgrade or top-up surface at all, so the notice states the situation and
 * stops. It appears only when the *backend* reports the limit as reached
 * (`rateLimitReachedType` / `spendControlReached`), never from a usage
 * percentage threshold invented client-side.
 */
export function UsageNotice() {
  const { state } = useStore();
  const { rateLimits } = state;

  if (!usageExhausted(rateLimits)) return null;

  const resets = rateLimits?.primary?.resetsAt;
  const reason = reasonText(rateLimits?.rateLimitReachedType ?? null);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-2">
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2.5">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-[13px] font-medium">{reason}</div>
          {resets != null && (
            <div className="text-xs text-muted-foreground">
              用量将于 {formatResetTime(resets)} 重置。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function reasonText(kind: string | null): string {
  switch (kind) {
    case "workspaceOwnerCreditsDepleted":
    case "workspaceMemberCreditsDepleted":
      return "工作区额度已用完";
    case "workspaceOwnerUsageLimitReached":
    case "workspaceMemberUsageLimitReached":
      return "已达到工作区用量上限";
    case "rateLimitReached":
      return "已达到用量上限";
    default:
      // `spendControlReached` with no `rateLimitReachedType` lands here.
      return "当前无法继续使用额度";
  }
}
