# 技能设置页搜索 Design

**日期：** 2026-08-19
**状态：** 已确认

## 背景与目标

Codex Desktop 的「设置 → 技能」页（`codex-desktop/ui/src/components/settings/SkillsSettings.tsx`）按 scope 分组展示全部已发现技能，仅提供启用/停用开关。技能数量增多后难以定位目标技能。本设计为该页增加**搜索框**，按名称/显示名、摘要/描述、路径过滤技能列表。

## 已确认决策

- **搜索位置**：仅「设置 → 技能」页顶部，输入框 `$` 联想不做改动（其已有按名称过滤）。
- **匹配字段**：显示名/名称、`skillSummary(skill)`（SKILL.json interface 的 shortDescription → 旧 shortDescription → description 的摘要）、`path`。
- **匹配方式**：大小写不敏感的子串匹配，与 `PluginsSettings` 的搜索实现一致。
- **过滤时机**：在按 scope 分组**之前**过滤，分组与排序逻辑保持不变；过滤后为空的 scope 分组隐藏。
- **空状态**：有查询但无任何匹配时，显示「没有匹配的技能。」，不渲染分组区。
- **无查询**：行为与现状完全一致（含 toggle、刷新等）。

## UI（`codex-desktop/ui/src/components/settings/SkillsSettings.tsx`）

- 本地 `useState("")` 查询框，复用 `PluginsSettings.tsx` 的搜索框样式（`Search` 图标 + `relative` 容器 + 圆角输入框，`h-8 w-full rounded-lg border border-input bg-background pl-8`）。
- 查询框放在「已发现的技能」/ scope 分组之前、`SettingsHeader` 之后，与内容同宽。
- 过滤逻辑：

  ```ts
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? skills.filter((skill) =>
        [skill.interface?.displayName?.trim() || skill.name, skillSummary(skill), skill.path]
          .some((field) => field.toLowerCase().includes(needle)),
      )
    : skills;
  ```

- `grouped` 由 `filtered` 计算；某 scope 无条目则不再渲染对应 `SettingsSection`。
- 渲染分支：`filtered.length === 0` 且 `needle` 非空 → 「没有匹配的技能。」空提示（复用现有 `px-4 py-6 text-center text-sm text-muted-foreground` 样式）。

## 边界

- 不触碰 Rust 代码、`api.ts`、`store.tsx`、Composer 联想。
- 不改动「已发现的技能」空目录提示的现有语义（无技能与无匹配是两种状态，分开渲染）。
- 不引入新依赖；`Search` 图标来自已使用的 `lucide-react`。

## 验证

- 构建门槛：`cd codex-desktop/ui && pnpm build`（`tsc --noEmit && vite build`）。
- 手动冒烟检查：输入关键字按名称/描述/路径均能过滤；清空恢复完整列表；无匹配时显示空提示；分组与 toggle 行为不变。