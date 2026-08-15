import { SettingRow, SettingsHeader, SettingsSection } from "./SettingsPrimitives";

/**
 * The Git screen, which deliberately contains no controls.
 *
 * The Official App's Git settings page has seven controls. Checked one by one
 * against this repo, **none of them can be rendered here as a stored setting**:
 *
 * - 分支前缀 / 拉取请求合并方法 / 始终强制推送 / 创建草稿拉取请求 — no config key
 *   and no RPC anywhere in the repo. They are ChatGPT account settings, served
 *   at `/wham/settings/user` (`backend-client/src/client.rs`), and the create-task
 *   body this repo sends (`cloud-tasks-client/src/http.rs`) carries none of them.
 * - 提交说明 / 拉取请求指令 — prompt-injection points for commit-message and
 *   PR-description generation. This engine generates neither, so there is
 *   nothing local to inject into.
 * - 代码审查发送方式 — real, but a *per-request* parameter, not a preference:
 *   `turn_processor.rs` reads it as `delivery.unwrap_or(Inline)` and no config
 *   key backs it. It therefore lives at the review entry point, where the choice
 *   is actually made.
 *
 * Rendering any of them here would produce a control that looks live and
 * changes nothing — the specific failure ADR-0021 exists to prevent. So the
 * screen says where each thing really lives instead. Stating a true fact about
 * an existing capability is presentation (ADR-0021 test 2); inventing the
 * capability is what is forbidden.
 */
export function GitSettings() {
  return (
    <div>
      <SettingsHeader
        title="Git"
        description="这里没有可调的开关。Codex 的 git 能力都在用得到它们的地方，账号级的偏好则在 ChatGPT 账号里——下面说明各自在哪。"
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

      <SettingsSection title="提交署名">
        <SettingRow
          label="Co-authored-by: Codex"
          description={
            <>
              如果你在 ChatGPT 账号里启用了提交署名，Codex 写提交信息时会自动附上该
              trailer——本应用同样生效，因为它随引擎一起启用，不需要在这里开关。
            </>
          }
          note="本应用读不到该状态：它由服务端计算，客户端只有读取接口而没有写入接口，且没有任何 RPC 把结果暴露出来。所以这里只说明行为，不显示开或关。"
          control={<Where muted>ChatGPT 账号</Where>}
        />
      </SettingsSection>

      <SettingsSection title="在 ChatGPT 账号中设置">
        <SettingRow
          label="分支前缀、拉取请求合并方法、强制推送、草稿拉取请求"
          description="这些控制的是 ChatGPT 代你推送分支和创建 PR 时的行为。本应用的引擎从不推送、也不创建 PR，仓库里也没有任何配置项或接口承载它们。"
          control={<Where muted>chatgpt.com</Where>}
        />
        <SettingRow
          label="提交说明、拉取请求指令"
          description="这两段文字会加进提交信息和 PR 标题／描述的生成提示词里。本应用的引擎不生成提交信息，也不生成 PR 描述，所以本地没有可注入的位置。"
          control={<Where muted>chatgpt.com</Where>}
        />
      </SettingsSection>

      {/* Rendered as selectable text rather than a link: opening an external
          URL would need the Tauri opener plugin and a matching capability, and
          granting one for a single address is not worth the surface. */}
      <p className="text-xs text-muted-foreground">
        账号设置位于 <span className="select-all font-mono">chatgpt.com</span> 的 Codex 设置中。
      </p>
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
