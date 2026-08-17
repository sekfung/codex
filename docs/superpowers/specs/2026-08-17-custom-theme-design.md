# 设计：Codex Desktop 自定义主题色与字体（落地 ADR-0009 延期项）

日期：2026-08-17
状态：已确认

## 背景

ADR-0009 将官方 App 的完整主题自定义系统（per-token 覆盖 + 字体选择）推迟到 v1 之后。
当前版本仅支持 浅色 / 深色 / 跟随系统。本次落地该延期功能。

现状约束：
- `useTheme.ts` 维护 `ThemeMode = "light" | "dark" | "system"`，存 `localStorage`（ADR-0020：外观是桌面 chrome）。
- `index.css` 用 shadcn CSS 变量承载全部主题 token（ADR-0019），`.dark` 类切换深色。
- `@theme inline` 将 CSS 变量映射为 Tailwind 颜色，运行时内联覆盖变量可自然生效。
- 项目不捆绑字体文件（ADR-0019：官方专有字体不可用，以系统字体栈替代）。

## 范围

- **全部颜色 token** 可自定义（24 个，见下），浅色与深色**各自独立**一组覆盖。
- **预设字体栈列表**选择（无自定义输入，无捆绑字体）。
- 不包含 contrast 控制（ADR-0009 提到但定义含糊，YAGNI）。

## 数据模型与持久化

新增 localStorage key `codex-desktop-theme-customization`（与 `codex-desktop-theme-mode` 并列）。

```ts
interface ThemeCustomization {
  font: FontKey;                 // 跨模式共享
  light: ModePalette;            // 浅色独立自定义
  dark: ModePalette;             // 深色独立自定义
}
interface ModePalette {
  // hex 覆盖；缺省 key = 使用该模式内置默认值
  tokens: Partial<Record<ThemeTokenKey, string>>;
}
```

### Token 全集（24 个颜色 token，排除 `--radius` —— 尺寸 token 非颜色）

按编辑 UI 分组：

| 组 | tokens |
|---|---|
| 背景与前景 | background, foreground |
| 主色 | primary, primary-foreground |
| 卡片 | card, card-foreground |
| 弹出层 | popover, popover-foreground |
| 次级 | secondary, secondary-foreground |
| 弱化 | muted, muted-foreground |
| 强调 | accent, accent-foreground |
| 危险 | destructive, destructive-foreground |
| 边框/输入/焦点环 | border, input, ring |
| 侧栏 | sidebar, sidebar-foreground, sidebar-accent, sidebar-accent-foreground, sidebar-border |

### 字体预设

`FontKey` 到 font-family 栈的固定映射（仅覆盖 `--font-sans`，`--font-mono` 不动）。预设包含：系统默认无衬线栈、中文优先栈（苹方/微软雅黑）、系统等宽栈等，具体列表在 `themeTokens.ts` 中定义。

## 新模块：`ui/src/themeTokens.ts`

作为单一数据源，导出：

- `ThemeTokenKey`：24 个 token key 的联合类型。
- `TOKEN_GROUPS`：分组与中文标签（上表结构）。
- `DEFAULT_PALETTE`：`Record<"light" | "dark", Record<ThemeTokenKey, string>>`，与 `index.css` 的 `:root`/`.dark` 值一致，两处互相加"保持同步"注释。
- `effectivePalette(mode, overrides)`：默认值合并覆盖，返回完整调色板。
- `FontKey` + `FONT_OPTIONS`：`{ key, label, family }[]`。

## 主题应用：`useTheme.ts` 扩展

- `ThemeValue` 新增：
  - `customization: ThemeCustomization`
  - `setToken(mode: "light" | "dark", token: ThemeTokenKey, hex: string | null)`（null = 重置该 token）
  - `resetModeTokens(mode)`（一键还原该模式全部 token）
  - `setFont(font: FontKey)`
- 应用逻辑（`applyResolvedTheme` 扩展）：
  - 对每个 token key：解析后模式有覆盖则 `documentElement.style.setProperty("--"+key, hex)`，否则 `removeProperty`。
  - 基础值在 `:root`/`.dark` CSS 中，移除内联覆盖即回落默认，无需记录旧状态。
- 字体：`setProperty("--font-sans", family)`。
- 持久化：一个 effect 整体写入 JSON；初始化懒读并与空默认合并，旧数据不致崩。

## UI：`AppearanceSettings.tsx` 自定义区

替换现有占位文本：

- **字体行**：复用现有 `Select` 组件，选项为 `FONT_OPTIONS`。
- **模式 tab**：浅色 / 深色（组件内局部 state），决定编辑哪套 token。
- **Token 分组行**：每行 = token 中文名 + 默认值（弱化显示）+ 当前色块 + hex 文本输入 + Popover 内 `react-colorful` 取色器 + 仅覆盖时出现的重置按钮。
- **区块级「恢复默认」**：一键还原当前模式全部 token。
- **预览卡片**：改用 `effectivePalette` 渲染，实时反映自定义（「跟随系统」卡仍双半区同显）。

## 依赖与验证

- 新增 `react-colorful`（小取色库），Popover 弹层内使用；`index.css` 加少量主题感知样式（react-colorful 通过 CSS 变量定制）。
- UI 无测试框架；验证命令：`cd codex-desktop/ui && npm run build`（`tsc --noEmit` + `vite build`）。

## 错误处理与边界

- localStorage 数据损坏/过期：初始化时与默认结构合并，未知 key 忽略。
- hex 文本输入：字段允许自由编辑；仅在失焦/回车且值为合法 hex（`#RGB` 或 `#RRGGBB`）时应用，非法时不改变已生效的覆盖（取色器仍是权威输入）。
- 深色 token 覆盖与 `.dark` 类切换解耦：内联变量在任意模式都优先于 CSS 默认，随解析模式取对应覆盖。
