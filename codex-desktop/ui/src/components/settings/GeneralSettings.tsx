import { useState } from "react";

import { useStore } from "../../store";
import { useAsyncAction } from "./useAsyncAction";
import * as api from "../../api";
import type { ApprovalMode, UpdateStatus } from "../../types";
import { Button } from "@/components/ui/button";
import { ConfigPending, OriginNote, SettingRow, SettingsHeader, SettingsSection } from "./SettingsPrimitives";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";

// Follows reference screenshot 02. The 权限 section's three toggles are the
// same setting the composer's mode selector edits (ADR-0016 layer 1) — here
// they write the *persisted default* rather than a per-thread override
// (ADR-0020), which is why they go through `setDefaultApprovalMode`.
//
// The screenshot presents them as three switches, but they are not
// independent: they are three points on one escalating scale, so they behave
// as a radio group wearing switch clothing. Making them genuinely independent
// would let the user express states the underlying preset table has no way to
// represent (see `src/approval_mode.rs`).

const MODE_FOR_TOGGLE: Record<string, ApprovalMode> = {
  workspace: "requestApproval",
  autoReview: "helpMeApprove",
  fullAccess: "fullAccess",
};

export function GeneralSettings() {
  const { state, setDefaultApprovalMode } = useStore();
  const { busy, error, run } = useAsyncAction();

  const mode = state.defaultApprovalMode;

  async function apply(next: ApprovalMode) {
    await run(() => setDefaultApprovalMode(next));
  }

  /**
   * Turning a level off falls back to the level below it; turning one on
   * selects it. `requestApproval` is the floor — there is no "less than
   * workspace access" mode in the selector's mapping.
   */
  function toggle(id: keyof typeof MODE_FOR_TOGGLE, checked: boolean) {
    if (checked) return apply(MODE_FOR_TOGGLE[id]);
    if (id === "fullAccess") return apply("helpMeApprove");
    if (id === "autoReview") return apply("requestApproval");
    return apply("requestApproval");
  }

  if (!state.config) return <ConfigPending />;

  return (
    <>
      <SettingsHeader title="常规" />

      <SettingsSection title="权限">
        {mode === null && (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            当前 config.toml 中的权限组合无法用这三个开关表示（例如手工编辑过，或使用了只读预设）。
            调整下方任一开关会用对应的预设覆盖它。
          </div>
        )}
        <SettingRow
          label="默认权限"
          description={
            <>
              默认情况下，Codex 可以读取和编辑其工作区中的文件。需要时，它可以请求额外访问权限。
              <OriginNote keyPath="default_permissions" />
            </>
          }
          control={
            <Switch
              aria-label="默认权限"
              checked={mode !== null}
              disabled={busy}
              onCheckedChange={(checked) => void toggle("workspace", checked)}
            />
          }
        />
        <SettingRow
          label="自动审核"
          description={
            <>
              Codex 会自动审查额外访问权限请求。自动审查可能会出错。
              <OriginNote keyPath="approvals_reviewer" />
            </>
          }
          control={
            <Switch
              aria-label="自动审核"
              checked={mode === "helpMeApprove" || mode === "fullAccess"}
              disabled={busy}
              onCheckedChange={(checked) => void toggle("autoReview", checked)}
            />
          }
        />
        <SettingRow
          label="完整访问权限"
          description={
            <>
              当 Codex 以完全访问权限运行时，它无需你的批准即可编辑你电脑上的任何文件，并运行可访问网络的命令。这会显著增加数据丢失、泄露或意外行为的风险。
              <OriginNote keyPath="approval_policy" />
            </>
          }
          control={
            <Switch
              aria-label="完整访问权限"
              checked={mode === "fullAccess"}
              disabled={busy}
              onCheckedChange={(checked) => void toggle("fullAccess", checked)}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="常规">
        {/* The rest of screenshot 02's General section has no config key this
            build knows how to write, so each is shown inert with a reason
            rather than as a control that silently does nothing. */}
        <SettingRow
          label="默认文件打开目标"
          description="默认打开文件和文件夹的位置"
          disabled
          note="尚未接入"
          control={
            <Select aria-label="默认文件打开目标" value={null} options={[]} disabled placeholder="未找到目标" />
          }
        />
        {/* 智能体环境 / 集成终端 Shell from screenshot 02 are gone rather than
            shown inert. Both name a capability this engine does not have —
            there is no config key selecting where the agent runs or which
            shell a terminal opens, and `wsl_paths.rs`, which ADR-0006 named
            as their basis, is a path converter (see ADR-0022). What the
            engine does expose about the shell environment is a real screen
            of its own; the pointer below leads there instead of leaving two
            permanently dead rows implying they are coming. */}
        <SettingRow
          label="Shell 环境"
          description="智能体执行命令时的环境变量继承范围与登录 Shell 策略"
          control={<span className="text-xs text-muted-foreground">见「环境」设置</span>}
        />
      </SettingsSection>

      <UpdateSection />

      {error && <p className="text-xs text-destructive">写入配置失败：{error}</p>}
    </>
  );
}

/**
 * Self-update (ADR-0007).
 *
 * Ships unconfigured: the endpoint and signing pubkey are the user's to
 * supply. The `notConfigured` case is rendered as its own state rather than
 * folded into an error or a reassuring "up to date", because those would each
 * misreport it.
 */
function UpdateSection() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const { busy, error, run } = useAsyncAction();

  const check = () => run(async () => setStatus(await api.checkForUpdate()));
  const install = () => run(() => api.installUpdate());

  return (
    <SettingsSection title="更新">
      <SettingRow
        label="应用更新"
        description="Codex Desktop 独立于 CLI 发布，通过签名更新包自行更新。"
        control={
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void check()}>
            {busy ? "检查中…" : "检查更新"}
          </Button>
        }
      />
      {status?.status === "notConfigured" && (
        <div className="px-4 pb-3 text-xs text-muted-foreground">
          未启用自动更新：{status.reason}。需在 <code>tauri.conf.json</code> 的{" "}
          <code>plugins.updater</code> 中填入更新源地址与签名公钥后重新打包。
        </div>
      )}
      {status?.status === "upToDate" && (
        <div className="px-4 pb-3 text-xs text-muted-foreground">
          已是最新版本（{status.currentVersion}）。
        </div>
      )}
      {status?.status === "available" && (
        <div className="flex items-start justify-between gap-3 px-4 pb-3">
          <div className="min-w-0 text-xs text-muted-foreground">
            发现新版本 {status.version}（当前 {status.currentVersion}）。
            {status.notes && <span className="mt-1 block whitespace-pre-wrap">{status.notes}</span>}
          </div>
          <Button size="sm" disabled={busy} onClick={() => void install()}>
            {busy ? "安装中…" : "下载并安装"}
          </Button>
        </div>
      )}
      {error && <div className="px-4 pb-3 text-xs text-destructive">更新失败：{error}</div>}
    </SettingsSection>
  );
}
