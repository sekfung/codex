import { SettingRow, SettingsHeader, SettingsSection } from "./SettingsPrimitives";

/**
 * The Git screen, which deliberately contains no controls.
 *
 * The Official App's Git settings page has seven controls; checked one by
 * one against this repo, none of them can be rendered here as a stored
 * setting. The screen therefore states where each *local* git capability
 * actually lives instead. Rendering a dead control is the failure ADR-0021
 * exists to prevent; stating where a real capability lives is presentation.
 */
export function GitSettings() {
  return (
    <div>
      <SettingsHeader
        title="Git"
        description="这里没有可调的开关。Codex 的 git 能力都在用得到它们的地方——下面说明各自在哪。"
      />

      <SettingsSection title="在此应用中">
        <SettingRow
          label="代码审查"
          description="选择审查未提交的改动、与基线分支对比、某个提交，或自由描述；也在这里选择结果是出现在当前对话还是另开一个审查对话。"
          control={<Where>对话工具栏</Where>}
        />
        <SettingRow
          label="查看改动"
          description="工作区改动（尚未提交），以及与远端的对比（尚未推送，含本地已提交的部分）。"
          control={<Where>对话工具栏</Where>}
        />
        <SettingRow
          label="分支与变更量"
          description="当前分支，以及相对默认分支的增删行数。"
          control={<Where>会话状态</Where>}
        />
      </SettingsSection>
    </div>
  );
}

/** Points at where a capability actually lives, in place of a dead control. */
function Where({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={
        muted
          ? "rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
          : "rounded-md bg-accent px-2 py-1 text-xs"
      }
    >
      {children}
    </span>
  );
}
