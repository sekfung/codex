# 移除 Codex Desktop 账户 / 用量 / 计费功能及全部 ChatGPT 关联 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底移除 `codex-desktop/` 中的账户 / 用量 / 计费 UI、状态、RPC 与类型，使桌面端与 ChatGPT 无任何关联且无凭据也能启动。

**Architecture:** 纯删除型改造。依赖关系决定任务顺序：先删 Rust 命令（独立可编译），再删消费方 UI 组件，再删 store 状态/事件/reducer，最后删 API 与类型定义。`tsconfig.json` 开启了 `noUnusedLocals`/`noUnusedParameters`，因此每一任务结束时前端必须通过 `pnpm build`（`tsc --noEmit`）验证，任何残留引用都会导致编译失败。上游（CLI、app-server、protocol）一律不动。

**Tech Stack:** Rust + Tauri 2（后端命令）、React + TypeScript + Vite（前端）、pnpm（前端构建）。

## Global Constraints

- 只修改 `codex-desktop/`，不触碰 `codex-cli/`、`codex-rs/` 下除 `codex-desktop` 以外的任何 crate。
- `tsconfig.json` 开启 `strict` + `noUnusedLocals` + `noUnusedParameters` —— 前端每步必须 `pnpm build` 通过。
- Rust 侧每步必须 `cargo check -p codex-desktop`（在 `codex-rs/` 目录）通过；最终跑 `just test -p codex-desktop`。
- 不允许添加注释；保留文件现有的 doc comment 风格（中文）。
- 保留与 ChatGPT 账户无关的技术性标识：`modelProvider: "openai"`、`openai/form`、`mcp_server_openai_form_elicitation`、`codex_protocol::openai_models`。
- 提交信息遵循仓库既有风格（`refactor(desktop): …`）。
- 完成代码改动后运行 `just fmt`（`codex-rs` 目录），且不再重复跑测试。

---

### Task 1: 删除 Rust 账户命令

**Files:**
- Modify: `codex-desktop/src/commands.rs:17`（删除导入）、`codex-desktop/src/commands.rs:480-515`（删除命令块）
- Modify: `codex-desktop/src/integrations.rs:1`（模块注释）、`codex-desktop/src/integrations.rs:13`（删除导入）、`codex-desktop/src/integrations.rs:235-295`（删除命令块）
- Modify: `codex-desktop/src/main.rs:289-290`、`codex-desktop/src/main.rs:363-366`（从 `invoke_handler` 移除注册）

**Interfaces:**
- Consumes: 无（纯删除）
- Produces: `ClientRequest` 的 `GetAccount`/`GetAccountRateLimits`/`GetAccountTokenUsage`/`LoginAccount`/`CancelLoginAccount`/`LogoutAccount` 变体在本 crate 内不再被引用（协议定义保留在 app-server-protocol 中）。

- [ ] **Step 1: 删除 `commands.rs` 中的账户命令**

  删除 `src/commands.rs` 中第 480-515 行整个「--- Account (read-only) ---」区块（含 `read_account`、`read_account_rate_limits` 两个命令及其 doc comment）。同时删除第 17 行：

  ```rust
  use codex_app_server_protocol::GetAccountParams;
  ```

- [ ] **Step 2: 删除 `integrations.rs` 中的账户命令**

  删除 `src/integrations.rs` 中第 235-295 行整个「--- Account (账户) ---」区块（含 `read_account_usage`、`start_account_login`、`cancel_account_login`、`logout_account` 及其 doc comment）。删除第 13 行：

  ```rust
  use codex_app_server_protocol::LoginAccountParams;
  ```

  将文件头第 1 行模块注释改为：

  ```rust
  //! Commands behind the 连接 / 钩子 / 插件 settings screens.
  ```

- [ ] **Step 3: 从 `main.rs` 移除命令注册**

  在 `codex-desktop/src/main.rs` 的 `invoke_handler` 列表中删除 6 行：

  ```rust
  commands::read_account,
  commands::read_account_rate_limits,
  ```
  ```rust
  integrations::read_account_usage,
  integrations::start_account_login,
  integrations::cancel_account_login,
  integrations::logout_account,
  ```

- [ ] **Step 4: 验证编译**

  Run: `cargo check -p codex-desktop`
  Expected: 编译通过，无 unused import 警告。

- [ ] **Step 5: 提交**

  ```bash
  git add codex-desktop/src/commands.rs codex-desktop/src/integrations.rs codex-desktop/src/main.rs
  git commit -m "refactor(desktop): remove account/usage/login RPC commands"
  ```

---

### Task 2: 删除消费账户状态的前端 UI 组件

**Files:**
- Delete: `codex-desktop/ui/src/components/AccountFooter.tsx`
- Delete: `codex-desktop/ui/src/components/UsageNotice.tsx`
- Delete: `codex-desktop/ui/src/components/settings/AccountSettings.tsx`
- Modify: `codex-desktop/ui/src/components/Sidebar.tsx:31`、`codex-desktop/ui/src/components/Sidebar.tsx:178`
- Modify: `codex-desktop/ui/src/App.tsx:13`、`codex-desktop/ui/src/App.tsx:41`
- Modify: `codex-desktop/ui/src/components/settings/SettingsShell.tsx:7`、`codex-desktop/ui/src/components/settings/SettingsShell.tsx:27`、`codex-desktop/ui/src/components/settings/SettingsShell.tsx:70-71`、`codex-desktop/ui/src/components/settings/SettingsShell.tsx:187`
- Modify: `codex-desktop/ui/src/components/StatusPanel.tsx:30`、`codex-desktop/ui/src/components/StatusPanel.tsx:102-108`、`codex-desktop/ui/src/components/StatusPanel.tsx:134-149`
- Modify: `codex-desktop/ui/src/components/settings/GitSettings.tsx`（删除 ChatGPT 相关区块）

**Interfaces:**
- Consumes: `store` 的 `state.account`/`state.requiresOpenaiAuth`/`state.rateLimits`/`state.pendingLogin`（本任务后无任何组件再读取它们）
- Produces: 无新接口。`formatResetTime`/`usageExhausted`（原 `AccountFooter.tsx` 导出）在本任务后不再被引用。

- [ ] **Step 1: 删除三个组件文件**

  ```bash
  git rm codex-desktop/ui/src/components/AccountFooter.tsx
  git rm codex-desktop/ui/src/components/UsageNotice.tsx
  git rm codex-desktop/ui/src/components/settings/AccountSettings.tsx
  ```

- [ ] **Step 2: 清理 `Sidebar.tsx`**

  删除第 31 行 `import { AccountFooter } from "./AccountFooter";`，删除第 178 行 `<AccountFooter />`（footer 区块仅保留设置/主题按钮，外层 `<footer>` 结构不变）。

- [ ] **Step 3: 清理 `App.tsx`**

  删除第 13 行 `import { UsageNotice } from "./components/UsageNotice";`，删除第 41 行 `<UsageNotice />`。

- [ ] **Step 4: 清理 `SettingsShell.tsx`**

  - 删除第 7 行 `import { CreditCard }`（图标列表中的 `CreditCard,`）。**保留 `User` 导入**——`interface NavItem` 的 `Icon: typeof User` 仍在使用。
  - 删除第 27 行 `import { AccountSettings } from "./AccountSettings";`。
  - 在 `NAV_GROUPS` 的「个人」分组中删除两行导航项：
    ```tsx
    { id: "usage", label: "使用情况和计费", Icon: CreditCard },
    { id: "account", label: "账户", Icon: User, ready: true },
    ```
  - 删除主渲染区第 187 行 `{active === "account" && <AccountSettings />}`。

- [ ] **Step 5: 清理 `StatusPanel.tsx`**

  - 删除第 30 行 `const limits = state.rateLimits;`。
  - 删除「账户」区块：
    ```tsx
    <Section title="账户">
      <Row label="登录" value={accountLabel(state.account, state.requiresOpenaiAuth)} />
      {limits?.primary?.usedPercent !== undefined && (
        <Row label="额度已用" value={`${Math.round(limits.primary.usedPercent)}%`} />
      )}
      {limits?.rateLimitReachedType && <Row label="限额" value="已达上限" />}
    </Section>
    ```
  - 删除第 134-149 行的 `accountLabel` 函数（含其上方 doc comment）。

- [ ] **Step 6: 精简 `GitSettings.tsx`**

  删除以下内容（整个区块，含 doc comment 中解释七个 ChatGPT 控件的部分）：
  - 文件头 doc comment（第 3-26 行）重写为：
    ```tsx
    /**
     * The Git screen, which deliberately contains no controls.
     *
     * The Official App's Git settings page has seven controls; checked one by
     * one against this repo, none of them can be rendered here as a stored
     * setting. The screen therefore states where each *local* git capability
     * actually lives instead. Rendering a dead control is the failure ADR-0021
     * exists to prevent; stating where a real capability lives is presentation.
     */
    ```
  - 删除第 32 行 `SettingsHeader` 的 `description`（改为不复述 ChatGPT 账号，可去掉该 prop 或改成纯本地说明，如 `"这里没有可调的开关。Codex 的 git 能力都在用得到它们的地方——下面说明各自在哪。"`）。
  - 删除「提交署名」整节（`<SettingsSection title="提交署名">…</SettingsSection>`）。
  - 删除「在 ChatGPT 账号中设置」整节（`<SettingsSection title="在 ChatGPT 账号中设置">…</SettingsSection>`）。
  - 删除末尾的 chatgpt.com 说明段落（`{/* Rendered as selectable text … */}` 及其 `<p>`）。
  - `Where` helper 保留（「在此应用中」区块仍在使用）。

- [ ] **Step 7: 验证前端编译**

  Run: `pnpm build`（在 `codex-desktop/ui`）
  Expected: `tsc --noEmit` 与 `vite build` 均通过。

- [ ] **Step 8: 提交**

  ```bash
  git add codex-desktop/ui/src
  git commit -m "refactor(desktop): remove account/usage/billing UI components"
  ```

---

### Task 3: 删除 store 账户状态、事件路由与 reducer 分支

**Files:**
- Modify: `codex-desktop/ui/src/store.tsx`
- Modify: `codex-desktop/ui/src/store/events.ts`
- Modify: `codex-desktop/ui/src/store/reducer.ts`

**Interfaces:**
- Consumes: `api` 的账户函数（`readAccount`/`readAccountRateLimits` 等）——本任务后不再被调用
- Produces: `StoreValue` 不再暴露 `startLogin`/`cancelLogin`/`logout`/`refreshAccount`；`NotificationEffects` 不再暴露 `refetchAccount`；`State` 不再含 `account`/`requiresOpenaiAuth`/`rateLimits`/`pendingLogin`。

- [ ] **Step 1: 清理 `store/reducer.ts`**

  - 从类型导入块删除 3 个标识符：`Account`、`RateLimitSnapshot`、`PendingLogin`（第 10、27、30 行附近，`import type { … }`）。
  - 从 `State` 接口删除字段及注释：
    - `account: Account | null;`、`requiresOpenaiAuth: boolean;`、`rateLimits: RateLimitSnapshot | null;`（第 193-195 行，连同第 189-192 行的 doc comment「Read-only account state…」）
    - `pendingLogin: PendingLogin | null;`（第 303-304 行，连同注释）
  - 从 `Action` 联合类型删除 6 个变体：
    ```ts
    | { type: "ACCOUNT_LOADED"; account: Account | null; requiresOpenaiAuth: boolean }
    | { type: "ACCOUNT_PLAN_UPDATED"; planType: string | null }
    | { type: "RATE_LIMITS_LOADED"; rateLimits: RateLimitSnapshot }
    | { type: "RATE_LIMITS_MERGED"; rateLimits: RateLimitSnapshot }
    ```
    以及：
    ```ts
    | { type: "LOGIN_STARTED"; login: PendingLogin }
    | { type: "LOGIN_COMPLETED"; error: string | null };
    ```
  - 删除 `mergeRateLimits` 函数（第 461-478 行，含 doc comment）。
  - 删除 reducer 分支：`case "ACCOUNT_LOADED":`（第 569-574 行）、`case "ACCOUNT_PLAN_UPDATED":`（第 575-579 行）、`case "RATE_LIMITS_LOADED":`（第 580-581 行）、`case "RATE_LIMITS_MERGED":`（第 582-585 行）、`case "LOGIN_STARTED":`（第 960-961 行）、`case "LOGIN_COMPLETED":`（第 962-971 行）。
  - 从 `initialState` 删除：`account: null,`、`requiresOpenaiAuth: false,`、`rateLimits: null,`（第 984-986 行）、`pendingLogin: null,`（第 1012 行）。

- [ ] **Step 2: 清理 `store/events.ts`**

  - 从 `import type { … } from "../types"` 删除 `RateLimitSnapshot`。
  - 从 `NotificationEffects` 接口删除 `refetchAccount: () => void;`（第 38 行）。
  - 删除三个事件处理：`"account/updated"`（第 234-244 行）、`"account/rateLimits/updated"`（第 246-250 行）、`"account/login/completed"`（第 252-260 行），连同第 234 行的 `// Account. Read-only: …` 注释。

- [ ] **Step 3: 清理 `store.tsx`**

  - 从 `import type { … } from "./types"` 删除 `PendingLogin`。
  - 从 `StoreValue` 接口删除（第 147-154 行）：
    ```ts
    /**
     * Account sign-in / sign-out (账户 screen). Read-only elsewhere: this app
     * has no billing, upgrade or credit-purchase path anywhere.
     */
    startLogin: () => Promise<void>;
    cancelLogin: () => Promise<void>;
    logout: () => Promise<void>;
    refreshAccount: () => void;
    ```
  - 删除 `pendingLoginRef`（第 194-197 行，含注释）。
  - 删除 `refetchAccount` 回调（第 280-296 行，含 doc comment「Read-only account state for the sidebar footer…」）。
  - 删除启动 effect（第 432-440 行，含 `refetchAccount();` 与 `api.readAccountRateLimits()` 的整个 `useEffect`）。
  - 在 `onAppServerEvent` 的 effects 对象里删除 `refetchAccount,` 行（第 407 行）；在 useEffect 依赖数组里删除 `refetchAccount,`（第 424 行）。
  - 删除 `startLogin`（第 1060-1092 行）、`cancelLogin`（第 1094-1099 行）、`logout`（第 1101-1104 行）三个回调。
  - 从 `useMemo` 返回值对象删除 `startLogin,` `cancelLogin,` `logout,` `refreshAccount: refetchAccount,`（第 1154-1157 行）；从依赖数组删除 `startLogin,` `cancelLogin,` `logout,` `refetchAccount,`（第 1205-1208 行）。

- [ ] **Step 4: 验证前端编译**

  Run: `pnpm build`（在 `codex-desktop/ui`）
  Expected: `tsc --noEmit` 通过。若报错，通常是遗漏了某个 `refetchAccount`/`PendingLogin` 引用，逐处清理即可。

- [ ] **Step 5: 提交**

  ```bash
  git add codex-desktop/ui/src/store.tsx codex-desktop/ui/src/store
  git commit -m "refactor(desktop): remove account state, events and reducer branches"
  ```

---

### Task 4: 删除前端 API 函数与类型定义

**Files:**
- Modify: `codex-desktop/ui/src/api.ts:154`、`codex-desktop/ui/src/api.ts:174-176`、`codex-desktop/ui/src/api.ts:579-589`
- Modify: `codex-desktop/ui/src/types.ts:224-287`、`codex-desktop/ui/src/types.ts:949-980`

**Interfaces:**
- Consumes: 无（Task 2、3 后已无调用方）
- Produces: `api` 模块不再导出任何账户函数；`types` 不再导出账户类型。

- [ ] **Step 1: 删除 `api.ts` 中的账户读取函数**

  - 删除第 174-176 行：
    ```ts
    export const readAccount = () => invoke<GetAccountResponse>("read_account");
    export const readAccountRateLimits = () =>
      invoke<GetAccountRateLimitsResponse>("read_account_rate_limits");
    ```
  - 第 154 行的区块注释 `// -- Account (read-only: no billing, upgrade or top-up path exists) ----------` 下方是 `AgentThreadInfo`/`readAgentThread`（sub-agent 线程身份，与本任务无关，保留）。将该注释改为 `// -- Agent-thread identity --------------------------------------------`，以免误导。

- [ ] **Step 2: 删除 `api.ts` 中的登录/登出/用量函数**

  删除第 579-589 行整个区块（含 `readAccountUsage` 及 doc comment「Sign-in and sign-out only…」、`startAccountLogin`、`cancelAccountLogin`、`logoutAccount`）。

- [ ] **Step 3: 删除 `types.ts` 中的账户类型**

  - 删除第 224-287 行整个「-- Account (read-only; no billing/upgrade surface anywhere) --」区块：`PlanType`、`Account`、`GetAccountResponse`、`RateLimitWindow`、`CreditsSnapshot`、`RateLimitReachedType`、`RateLimitSnapshot`、`GetAccountRateLimitsResponse`。
  - 删除第 949-980 行整个「-- Account (账户) --」区块：`AccountTokenUsageSummary`、`GetAccountTokenUsageResponse`、`LoginAccountResponse`、`PendingLogin`。

- [ ] **Step 4: 验证前端编译**

  Run: `pnpm build`（在 `codex-desktop/ui`）
  Expected: `tsc --noEmit` 通过，无未使用类型/导入报错。

- [ ] **Step 5: 提交**

  ```bash
  git add codex-desktop/ui/src/api.ts codex-desktop/ui/src/types.ts
  git commit -m "refactor(desktop): remove account API functions and types"
  ```

---

### Task 5: 残余引用清理与全量验证

**Files:**
- Modify: `codex-desktop/ui/src/components/Composer.tsx:362`
- 验证产物，无新增文件。

**Interfaces:**
- Consumes: 前 4 个任务的输出。

- [ ] **Step 1: 清理 `Composer.tsx` 注释**

  第 362 行的注释含 "插件 / ChatGPT 对话 sections"。改为：

  ```tsx
   * 计划模式 and the 插件 sections are separate capabilities; cross-conversation
   * references have no basis in this engine at all.
  ```

- [ ] **Step 2: 全局搜索残留引用**

  在 `codex-desktop/` 下搜索以下关键词，确认仅剩允许项：
  - `chatgpt`（允许：无——应清零）
  - `ChatGPT`（允许：无——应清零）
  - `账户`（允许：无——应清零）
  - `用量` / `额度` / `计费` / `billing` / `usageExhausted` / `formatResetTime`（应清零；`ContextMeter` 的「上下文用量」「累计用量」是上下文窗口用量，不在账户语境，可保留，但确认其措辞未引用账户）
  - 允许保留的技术性标识：`modelProvider: "openai"`、`openai/form`、`mcp_server_openai_form_elicitation`、`codex_protocol::openai_models`、`ReasoningEffort`。
  - 确认 `StoreValue`/`State`/`NotificationEffects` 无 `account`/`rateLimits`/`pendingLogin`/`refetchAccount`/`startLogin`/`logout` 残留。

- [ ] **Step 3: 格式化**

  Run: `just fmt`（在 `codex-rs` 目录）
  Expected: 格式化脚本无错误退出。

- [ ] **Step 4: 运行后端测试**

  Run: `just test -p codex-desktop`
  Expected: 全部测试通过（本计划无账户相关测试，现有测试不受影响）。

- [ ] **Step 5: 前端构建**

  Run: `pnpm build`（在 `codex-desktop/ui`）
  Expected: 通过。

- [ ] **Step 6: 提交**

  ```bash
  git add codex-desktop/ui/src/components/Composer.tsx
  git commit -m "refactor(desktop): clean up remaining ChatGPT references"
  ```
