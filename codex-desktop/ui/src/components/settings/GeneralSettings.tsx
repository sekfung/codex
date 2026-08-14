import { useState } from "react";

import { useStore } from "../../store";
import type { ApprovalMode } from "../../types";
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mode = state.defaultApprovalMode;

  async function apply(next: ApprovalMode) {
    setBusy(true);
    setError(null);
    try {
      await setDefaultApprovalMode(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  /// Turning a level off falls back to the level below it; turning one on
  /// selects it. `requestApproval` is the floor — there is no "less than
  /// workspace access" mode in the selector's mapping.
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
        <SettingRow
          label="智能体环境"
          description="选择智能体的运行位置"
          disabled
          note="尚未接入：环境设置（ADR-0006 中仍属 v1 范围）计划在后续增量中接入。"
          control={<Select aria-label="智能体环境" value={null} options={[]} disabled placeholder="本机" />}
        />
        <SettingRow
          label="集成终端 Shell"
          description="选择要在集成终端中打开的 Shell"
          disabled
          note="尚未接入"
          control={<Select aria-label="集成终端 Shell" value={null} options={[]} disabled placeholder="默认" />}
        />
      </SettingsSection>

      {error && <p className="text-xs text-destructive">写入配置失败：{error}</p>}
    </>
  );
}
