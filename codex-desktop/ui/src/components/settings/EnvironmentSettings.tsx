import { useStore } from "../../store";
import { useAsyncAction } from "./useAsyncAction";
import {
  ConfigPending,
  OriginNote,
  SettingRow,
  SettingsHeader,
  SettingsSection,
} from "./SettingsPrimitives";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";

/**
 * 环境 — the shell environment the agent runs commands in.
 *
 * ADR-0006 lists this screen as in scope and names `cli/src/wsl_paths.rs` as
 * its basis. That basis does not hold: `wsl_paths.rs` is a 59-line path
 * converter (`C:\foo` → `/mnt/c/foo`) called once from `main.rs`, `is_wsl`
 * only adapts clipboard and keyboard handling, and there is no WSL config key
 * anywhere. So the reference screenshot's 智能体环境 and 集成终端 Shell rows
 * have nothing behind them in this repo, and ADR-0021 says the answer to that
 * is to say so, not to fake a control. ADR-0022 records the correction.
 *
 * What does exist is the shell-environment policy the engine really reads, so
 * that is what this screen edits. All of it is `config.toml` (ADR-0020),
 * written through `config/value/write` like every other settings screen.
 *
 * These keys are not named fields on `v2::Config`; they arrive through its
 * `#[serde(flatten)] additional` map, so they stay **snake_case** on the wire
 * while their camelCase neighbours do not — the same trap `default_permissions`
 * carries.
 */

type Inherit = "all" | "core" | "none";

const INHERIT_OPTIONS: { value: Inherit; label: string; description: string }[] = [
  { value: "all", label: "全部继承", description: "继承父进程的完整环境变量" },
  {
    value: "core",
    label: "仅核心变量",
    description: "只继承 HOME、PATH、SHELL、USER 等平台核心变量",
  },
  { value: "none", label: "不继承", description: "不从父进程继承任何环境变量" },
];

/** Reads a flattened key, tolerating the absence that means "engine default". */
function readBool(config: Record<string, unknown>, key: string): boolean | null {
  const value = config[key];
  return typeof value === "boolean" ? value : null;
}

function readPolicy(config: Record<string, unknown>): Record<string, unknown> {
  const policy = config["shell_environment_policy"];
  return policy && typeof policy === "object" ? (policy as Record<string, unknown>) : {};
}

export function EnvironmentSettings() {
  const { state, writeSetting } = useStore();
  const { busy, error, run } = useAsyncAction();

  if (!state.config) return <ConfigPending />;

  const config = state.config as Record<string, unknown>;
  const policy = readPolicy(config);

  const inheritValue = policy["inherit"];
  const inherit: Inherit | null =
    inheritValue === "all" || inheritValue === "core" || inheritValue === "none"
      ? inheritValue
      : null;

  // Absent means the engine's own default, which differs per key: inheriting
  // everything, and allowing a login shell. Showing the default as the current
  // value is honest here because that is what the agent will actually do.
  const allowLoginShell = readBool(config, "allow_login_shell") ?? true;
  const ignoreDefaultExcludes =
    typeof policy["ignore_default_excludes"] === "boolean"
      ? (policy["ignore_default_excludes"] as boolean)
      : false;
  const useProfile =
    typeof policy["experimental_use_profile"] === "boolean"
      ? (policy["experimental_use_profile"] as boolean)
      : false;

  // The remaining `ShellEnvironmentPolicyToml` fields — `set`, `exclude`,
  // `include_only`, `filters` — are maps and pattern lists. They are shown as
  // a count rather than edited: a control that could only express part of a
  // pattern table would quietly drop the rest on save.
  const patternKeys = ["set", "exclude", "include_only", "filters"] as const;
  const patternSummary = patternKeys
    .map((key) => {
      const value = policy[key];
      if (Array.isArray(value) && value.length > 0) return `${key} (${value.length})`;
      if (value && typeof value === "object") {
        const count = Object.keys(value as Record<string, unknown>).length;
        return count > 0 ? `${key} (${count})` : null;
      }
      return null;
    })
    .filter((entry): entry is string => entry !== null);

  return (
    <>
      <SettingsHeader
        title="环境"
        description="智能体执行命令时所处的 Shell 环境。这些设置写入 config.toml，CLI 同样生效。"
      />

      <SettingsSection title="环境变量">
        <SettingRow
          label="继承范围"
          description={
            INHERIT_OPTIONS.find((option) => option.value === (inherit ?? "all"))?.description
          }
          control={
            <>
              <Select<Inherit>
                aria-label="继承范围"
                value={inherit ?? "all"}
                options={INHERIT_OPTIONS.map(({ value, label }) => ({ value, label }))}
                disabled={busy}
                onValueChange={(value) =>
                  void run(() =>
                    writeSetting({ keyPath: "shell_environment_policy.inherit", value }),
                  )
                }
              />
              <OriginNote keyPath="shell_environment_policy.inherit" />
            </>
          }
        />
        <SettingRow
          label="忽略默认排除项"
          description="默认会排除名称疑似密钥的变量。开启后不再自动排除，仅按下方的模式表过滤。"
          control={
            <Switch
              aria-label="忽略默认排除项"
              checked={ignoreDefaultExcludes}
              disabled={busy}
              onCheckedChange={(checked) =>
                void run(() =>
                  writeSetting({
                    keyPath: "shell_environment_policy.ignore_default_excludes",
                    value: checked,
                  }),
                )
              }
            />
          }
        />
        <SettingRow
          label="变量过滤规则"
          description="set / exclude / include_only / filters 是映射与模式表，此处只做展示，请在 config.toml 中编辑。"
          note={patternSummary.length === 0 ? "未配置" : undefined}
          control={
            <span className="text-xs text-muted-foreground">
              {patternSummary.length === 0 ? "—" : patternSummary.join("、")}
            </span>
          }
        />
      </SettingsSection>

      <SettingsSection title="Shell">
        <SettingRow
          label="允许登录 Shell"
          description="关闭后，模型无法请求登录 Shell（login = true 会被拒绝）。"
          control={
            <>
              <Switch
                aria-label="允许登录 Shell"
                checked={allowLoginShell}
                disabled={busy}
                onCheckedChange={(checked) =>
                  void run(() => writeSetting({ keyPath: "allow_login_shell", value: checked }))
                }
              />
              <OriginNote keyPath="allow_login_shell" />
            </>
          }
        />
        <SettingRow
          label="使用 Shell 配置文件"
          description="实验性：执行命令前加载用户的 Shell profile。"
          control={
            <Switch
              aria-label="使用 Shell 配置文件"
              checked={useProfile}
              disabled={busy}
              onCheckedChange={(checked) =>
                void run(() =>
                  writeSetting({
                    keyPath: "shell_environment_policy.experimental_use_profile",
                    value: checked,
                  }),
                )
              }
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="远程执行环境">
        <SettingRow
          label="远程环境"
          description="environment/add 等接口可连接远程 exec-server，但目前仅为实验性协议，CLI 与 TUI 均未使用。"
          disabled
          note="尚未接入：本仓库没有任何客户端使用该能力（ADR-0021）。"
          control={<span className="text-xs text-muted-foreground">—</span>}
        />
      </SettingsSection>

      {error && <div className="text-xs text-destructive">保存失败：{error}</div>}
    </>
  );
}
