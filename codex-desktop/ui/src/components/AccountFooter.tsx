import { CircleUser } from "lucide-react";

import { useStore } from "../store";
import type { Account, PlanType, RateLimitSnapshot } from "../types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/// Identity + plan in the sidebar footer, read from `account/read` and kept
/// current by `account/updated` (ADR-0021: never by reading `auth.json`).
///
/// Read-only by construction — this app has no billing, upgrade or top-up
/// path anywhere, so there is nothing to click through to here.
export function AccountFooter() {
  const { state } = useStore();
  const { account, requiresOpenaiAuth, rateLimits } = state;

  const label = accountLabel(account, requiresOpenaiAuth);
  const detail = accountDetail(account, rateLimits);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-medium text-background">
        {label.initial ?? <CircleUser className="size-3.5" />}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="min-w-0">
            <div className="truncate text-xs">{label.primary}</div>
            {detail && <div className="truncate text-[11px] text-muted-foreground">{detail}</div>}
          </div>
        </TooltipTrigger>
        <TooltipContent>{[label.primary, detail].filter(Boolean).join(" · ")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function accountLabel(
  account: Account | null,
  requiresOpenaiAuth: boolean,
): { primary: string; initial: string | null } {
  if (!account) {
    // Distinguish "we know you're signed out" from "we haven't loaded yet":
    // `requiresOpenaiAuth` is the server telling us auth is actually needed.
    return {
      primary: requiresOpenaiAuth ? "未登录" : "账户加载中…",
      initial: null,
    };
  }
  switch (account.type) {
    case "chatgpt": {
      const email = account.email?.trim();
      return {
        primary: email || "ChatGPT 账户",
        initial: email ? email[0]?.toUpperCase() : "C",
      };
    }
    case "apiKey":
      return { primary: "API Key", initial: "K" };
    case "amazonBedrock":
      return { primary: "Amazon Bedrock", initial: "B" };
    default:
      return { primary: "已登录", initial: null };
  }
}

/// Second line: plan, plus a usage note when the backend itself reports the
/// limit as reached. Never a threshold this app invents.
function accountDetail(account: Account | null, rateLimits: RateLimitSnapshot | null): string {
  const parts: string[] = [];

  const plan =
    account?.type === "chatgpt" ? account.planType : (rateLimits?.planType ?? null);
  if (plan) parts.push(planLabel(plan));

  const exhausted = usageExhausted(rateLimits);
  if (exhausted) {
    const resets = rateLimits?.primary?.resetsAt;
    parts.push(resets ? `额度已用完，${formatResetTime(resets)}重置` : "额度已用完");
  } else if (rateLimits?.primary?.usedPercent != null) {
    parts.push(`已用 ${rateLimits.primary.usedPercent}%`);
  }

  return parts.join(" · ");
}

/// True only when the *server* says usage is blocked. `rateLimitReachedType`
/// and `spendControlReached` are backend-reported fields; `null` on either
/// means "unavailable", not "fine", so neither is treated as a negative.
export function usageExhausted(rateLimits: RateLimitSnapshot | null): boolean {
  if (!rateLimits) return false;
  return rateLimits.rateLimitReachedType != null || rateLimits.spendControlReached === true;
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  go: "Go",
  plus: "Plus",
  pro: "Pro",
  pro_lite: "Pro Lite",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
};

function planLabel(plan: PlanType): string {
  return PLAN_LABELS[plan] ?? plan;
}

/// `resetsAt` is Unix **seconds** on the wire (`RateLimitWindow.resets_at`).
export function formatResetTime(resetsAtSeconds: number): string {
  const date = new Date(resetsAtSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
