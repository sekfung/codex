# 彻底移除 Codex Desktop 中的账户 / 用量 / 计费功能及全部 ChatGPT 关联

日期：2026-08-17

## 背景与目标

`codex-desktop`（Tauri 2 桌面客户端）目前含有多处与 ChatGPT 账户、套餐、用量、计费相关的 UI 与后端逻辑。目标：

1. 彻底移除「使用情况和计费」与「账户」两个设置入口及其全部支撑代码。
2. 桌面端与 ChatGPT 不再有任何关系：删除登录/退出登录流程、账户身份与套餐展示、额度/用量展示。
3. 没有 ChatGPT 账号（甚至没有任何 API Key）也能正常启动应用。

**范围约束**：只修改 `codex-desktop/`（Rust 后端 + `ui/` React 前端）。CLI、`codex-app-server`、`codex-protocol` 等上游一概不动。引擎不在启动时校验登录，因此删除登录 UI 后，「无凭据也能启动」自然成立——只有在真正发送消息而缺少凭据时，引擎自身的错误才会出现（保留引擎原行为，桌面端不做任何拦截）。

## 移除清单

### A. 前端 UI 组件

| 文件 | 处理 |
|---|---|
| `ui/src/components/AccountFooter.tsx` | 整文件删除（侧边栏底部的账户身份/套餐/用量 footer） |
| `ui/src/components/UsageNotice.tsx` | 整文件删除（对话上方的额度用完横幅） |
| `ui/src/components/settings/AccountSettings.tsx` | 整文件删除（「账户」设置页：登录/退出/用量限制/累计用量） |
| `ui/src/components/Sidebar.tsx` | 移除 `AccountFooter` 的 import 与渲染；底部 footer 只保留设置/主题按钮 |
| `ui/src/App.tsx` | 移除 `UsageNotice` 的 import 与渲染 |
| `ui/src/components/settings/SettingsShell.tsx` | 移除「使用情况和计费」（`usage`）与「账户」（`account`）两个导航项及渲染分支；清理 `CreditCard`、`User` 图标导入 |
| `ui/src/components/StatusPanel.tsx` | 移除「账户」区块（登录行、额度已用行、限额行）及 `accountLabel` helper；`rateLimits`/`limits` 引用随之清理 |
| `ui/src/components/settings/GitSettings.tsx` | 删除「提交署名」与「在 ChatGPT 账号中设置」两个区块（其内容全部指向 ChatGPT 账号侧设置），保留「在此应用中」本地 git 能力说明 |

### B. 前端状态 / API / 类型

| 文件 | 处理 |
|---|---|
| `ui/src/api.ts` | 删除 `readAccount`、`readAccountRateLimits`、`readAccountUsage`、`startAccountLogin`、`cancelAccountLogin`、`logoutAccount` 及其类型引用 |
| `ui/src/types.ts` | 删除 `Account`、`PlanType`、`GetAccountResponse`、`RateLimitWindow`、`CreditsSnapshot`、`RateLimitReachedType`、`RateLimitSnapshot`、`GetAccountRateLimitsResponse`、`AccountTokenUsageSummary`、`GetAccountTokenUsageResponse`、`LoginAccountResponse`、`PendingLogin` |
| `ui/src/store.tsx` | 删除 `account`/`requiresOpenaiAuth`/`rateLimits`/`pendingLogin` 状态；删除 `refetchAccount`/`startLogin`/`cancelLogin`/`logout` 回调与相关 effect（含 `readAccountRateLimits` 拉取）、`pendingLoginRef`；从 `useMemo` 值与依赖数组移除对应项 |
| `ui/src/store/reducer.ts` | 删除 `account`/`requiresOpenaiAuth`/`rateLimits`/`pendingLogin` state 字段与初始值；删除 `ACCOUNT_LOADED`/`ACCOUNT_PLAN_UPDATED`/`RATE_LIMITS_LOADED`/`RATE_LIMITS_MERGED`/`LOGIN_STARTED`/`LOGIN_COMPLETED` action 分支；清理 `Account`/`RateLimitSnapshot`/`PendingLogin` 导入 |
| `ui/src/store/events.ts` | 删除 `account/updated`、`account/rateLimits/updated`、`account/login/completed` 事件处理及其类型导入 |

### C. 后端 Rust 命令

| 文件 | 处理 |
|---|---|
| `src/commands.rs` | 删除 `read_account`、`read_account_rate_limits` 及「--- Account (read-only) ---」区块与相关导入 |
| `src/integrations.rs` | 删除 `read_account_usage`、`start_account_login`、`cancel_account_login`、`logout_account` 及「--- Account (账户) ---」区块；更新文件头模块注释（不再提及「账户」设置页） |
| `src/main.rs` | 从 `invoke_handler` 移除上述 6 个命令 |

### D. 保留项（与 ChatGPT 账户/计费无关）

- MCP 连接 / 插件 / 钩子 / 技能等设置屏幕。
- `ConnectionsSettings.tsx` 中第三方 MCP 的 OAuth 登录（非 ChatGPT 账户登录）。
- `ContextMeter.tsx`（上下文窗口用量）、`GoalPanel.tsx`（目标 token 预算状态）。
- `EnvironmentSettings.tsx` 的「允许登录 Shell」（命令执行沙箱策略，非账户）。
- `StartupFailure` / `startup_failure`（引擎启动失败，与认证无关）。
- 顺手清理：`Composer.tsx` 一处代码注释中 "ChatGPT 对话 sections" 的措辞（属对官方 App 的说明，改为不提及 ChatGPT）。

## 验证

1. `just fmt`（在 `codex-rs` 目录执行，由 AGENTS.md 要求自动运行）。
2. `just test -p codex-desktop`。
3. `ui` 内 `pnpm build`（`tsc --noEmit` + `vite build`），确保前端类型与构建通过。
4. 全局搜索确认 `codex-desktop` 内不再残留 `chatgpt` / `账户` / `用量` / `billing` 相关引用（允许保留无关的 `modelProvider: "openai"`、`openai/form`、`mcp_server_openai_form_elicitation` 等技术性标识）。
