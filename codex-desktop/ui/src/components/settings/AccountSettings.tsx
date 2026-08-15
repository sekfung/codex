import { useEffect, useState } from "react";
import { ExternalLink, Loader2, LogOut } from "lucide-react";

import { useStore } from "../../store";
import { useAsyncAction } from "./useAsyncAction";
import * as api from "../../api";
import { formatResetTime, usageExhausted } from "../AccountFooter";
import type { AccountTokenUsageSummary, PlanType } from "../../types";
import { SettingRow, SettingsHeader, SettingsSection } from "./SettingsPrimitives";
import { Button } from "@/components/ui/button";

// Account.
//
// Basis per control (ADR-0021's admission test):
//   identity / plan     -> `account/read`, kept live by `account/updated`
//   limits              -> `account/rateLimits/read` + `account/rateLimits/updated`
//   usage totals        -> `account/usage/read`
//   sign in             -> `account/login/start` + `account/login/completed`
//   cancel sign-in      -> `account/login/cancel`
//   sign out            -> `account/logout`
//
// There is deliberately nothing here about billing, upgrades or credits.
// `account/rateLimitResetCredit/consume` and `account/sendAddCreditsNudgeEmail`
// exist in the protocol and are intentionally not wrapped: exhaustion is
// reported with its reset time and nothing to click.

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

export function AccountSettings() {
  const { state, startLogin, cancelLogin, logout, refreshAccount } = useStore();
  const { account, requiresOpenaiAuth, rateLimits, pendingLogin } = state;
  const [usage, setUsage] = useState<AccountTokenUsageSummary | null>(null);
  const { busyKey, isBusy, error, run } = useAsyncAction();

  useEffect(() => {
    // Usage is signed-in-only; asking while signed out just produces an error
    // that says nothing useful.
    if (!account) {
      setUsage(null);
      return;
    }
    api
      .readAccountUsage()
      .then((response) => setUsage(response.summary))
      .catch(() => setUsage(null));
  }, [account]);


  const signedOut = !account;

  return (
    <>
      <SettingsHeader title="账户" description="Codex 使用的登录身份与用量。" />

      <SettingsSection title="身份">
        {signedOut ? (
          <SettingRow
            label={requiresOpenaiAuth ? "未登录" : "账户状态未知"}
            description={
              requiresOpenaiAuth
                ? "Codex 需要登录后才能运行。登录状态与 CLI 共享（同一个 $CODEX_HOME）。"
                : "尚未读取到账户信息。"
            }
            control={
              pendingLogin ? (
                <span className="flex items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => void api.openPathInOs(pendingLogin.authUrl)}
                  >
                    重新打开链接
                    <ExternalLink />
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busyKey !== null}
                    onClick={() => void run(cancelLogin, { key: "cancel" })}
                  >
                    取消
                  </Button>
                </span>
              ) : (
                <Button
                  size="xs"
                  disabled={busyKey !== null}
                  onClick={() => void run(startLogin, { key: "login" })}
                >
                  {isBusy("login") ? <Loader2 className="animate-spin" /> : <ExternalLink />}
                  登录
                </Button>
              )
            }
          />
        ) : (
          <>
            <SettingRow
              label={identityLabel(account)}
              description={identityDetail(account)}
              control={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busyKey !== null}
                  onClick={() => void run(logout, { key: "logout" })}
                >
                  {isBusy("logout") ? <Loader2 className="animate-spin" /> : <LogOut />}
                  退出登录
                </Button>
              }
            />
            <SettingRow
              label="刷新"
              description="重新读取账户与用量信息。"
              control={
                <Button size="xs" variant="ghost" onClick={refreshAccount}>
                  刷新
                </Button>
              }
            />
          </>
        )}
      </SettingsSection>

      {pendingLogin && (
        <div className="mb-8 rounded-xl border border-border px-4 py-3 text-xs text-muted-foreground">
          {pendingLogin.error ?? "已在浏览器中打开登录页面，完成后此处会自动更新。"}
        </div>
      )}

      {rateLimits && (
        <SettingsSection title="用量限制">
          {usageExhausted(rateLimits) ? (
            <SettingRow
              label="额度已用完"
              description={
                rateLimits.primary?.resetsAt
                  ? `将于 ${formatResetTime(rateLimits.primary.resetsAt)} 重置。`
                  : "请稍后再试。"
              }
              control={null}
            />
          ) : (
            <>
              {rateLimits.primary?.usedPercent != null && (
                <SettingRow
                  label="主要额度"
                  description={
                    rateLimits.primary.resetsAt
                      ? `${formatResetTime(rateLimits.primary.resetsAt)} 重置`
                      : undefined
                  }
                  control={
                    <span className="text-[13px]">{rateLimits.primary.usedPercent}%</span>
                  }
                />
              )}
              {rateLimits.secondary?.usedPercent != null && (
                <SettingRow
                  label="次要额度"
                  description={
                    rateLimits.secondary.resetsAt
                      ? `${formatResetTime(rateLimits.secondary.resetsAt)} 重置`
                      : undefined
                  }
                  control={
                    <span className="text-[13px]">{rateLimits.secondary.usedPercent}%</span>
                  }
                />
              )}
            </>
          )}
        </SettingsSection>
      )}

      {usage && (
        <SettingsSection title="累计用量">
          {usage.lifetimeTokens != null && (
            <SettingRow
              label="累计 token"
              control={<span className="text-[13px]">{usage.lifetimeTokens.toLocaleString()}</span>}
            />
          )}
          {usage.peakDailyTokens != null && (
            <SettingRow
              label="单日峰值"
              control={
                <span className="text-[13px]">{usage.peakDailyTokens.toLocaleString()}</span>
              }
            />
          )}
          {usage.currentStreakDays != null && (
            <SettingRow
              label="当前连续使用"
              control={<span className="text-[13px]">{usage.currentStreakDays} 天</span>}
            />
          )}
        </SettingsSection>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}

type AccountValue = ReturnType<typeof useStore>["state"]["account"];

function identityLabel(account: NonNullable<AccountValue>): string {
  switch (account.type) {
    case "chatgpt":
      return account.email?.trim() || "ChatGPT 账户";
    case "apiKey":
      return "API Key";
    case "amazonBedrock":
      return "Amazon Bedrock";
    default:
      return "已登录";
  }
}

function identityDetail(account: NonNullable<AccountValue>): string | undefined {
  if (account.type !== "chatgpt") return undefined;
  const plan = account.planType as PlanType | null | undefined;
  return plan ? `${PLAN_LABELS[plan] ?? plan} 套餐` : undefined;
}
