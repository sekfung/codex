# 技能设置页搜索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a search box to the 设置 → 技能 page that filters the skill list by name/display name, summary/description, and path.

**Architecture:** Client-only filtering in `SkillsSettings.tsx`. A new local `query` state filters the flat `state.skills` catalog *before* the existing scope-grouping memo, so grouping/sorting/toggles are untouched. The search box reuses the exact input markup already used in `PluginsSettings.tsx`.

**Tech Stack:** React 18 + TypeScript, `lucide-react` `Search` icon, Tailwind. No new dependencies. No test framework in `codex-desktop/ui` — verification is `pnpm build` (`tsc --noEmit && vite build`) plus manual smoke.

## Global Constraints

- Only modify `codex-desktop/ui/src/components/settings/SkillsSettings.tsx`.
- Do not touch Rust, `api.ts`, `store.tsx`, `types.ts`, or the composer's `$` typeahead.
- Reuse `Search` from `lucide-react` (already a dependency).
- Match the `PluginsSettings.tsx` search-input styling exactly (`Search` icon + `relative` wrapper + `h-8 w-full rounded-lg border border-input bg-background pl-8` input).
- Keep grouping/sorting/toggle behavior identical when the query is empty.
- Spec: `docs/superpowers/specs/2026-08-19-skills-settings-search-design.md`.

---

### Task 1: Search box and filtering in SkillsSettings

**Files:**
- Modify: `codex-desktop/ui/src/components/settings/SkillsSettings.tsx`

**Interfaces:**
- Consumes: `useStore().state.skills: SkillMetadata[]`, `skillSummary(skill): string` from `../../types`, `SettingRow/SettingsHeader/SettingsSection` from `./SettingsPrimitives`, `Switch` from `@/components/ui/switch`.
- Produces: filtered+grouped list rendered with the same `SettingsSection`/`SettingRow` markup; search box above the groups.

- [ ] **Step 1: Add imports and query state**

Add `Search` to the `lucide-react` import (currently `import { Loader2 } from "lucide-react";`) and `useState` to the React import (currently `import { useEffect, useMemo } from "react";`).

```tsx
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
```

Inside `SkillsSettings`, after `const skills = state.skills;` add the query state:

```tsx
const [query, setQuery] = useState("");
```

- [ ] **Step 2: Filter before grouping**

Change the `grouped` memo to compute from a filtered list, then add an empty-match branch in the render. Replace the existing `grouped` memo (lines ~50-61) with:

```tsx
const needle = query.trim().toLowerCase();
const visible = needle
  ? skills.filter((skill) =>
      [skill.interface?.displayName?.trim() || skill.name, skillSummary(skill), skill.path]
        .some((field) => field.toLowerCase().includes(needle)),
    )
  : skills;

const grouped = useMemo(() => {
  const byScope = new Map<string, SkillMetadata[]>();
  for (const skill of visible) {
    const list = byScope.get(skill.scope) ?? [];
    list.push(skill);
    byScope.set(skill.scope, list);
  }
  for (const list of byScope.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...byScope.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}, [visible]);
```

- [ ] **Step 3: Render the search box and no-match empty state**

Insert the search box between `</SettingsHeader>` and the existing `grouped.length === 0` conditional, and add the no-match branch. The render block becomes:

```tsx
      <SettingsHeader
        title="技能"
        description="技能是 Codex 可以按需加载的指令集，在对话框中用 $ 引用。这里只能启用或停用它们 — 技能内容定义在各自的 SKILL.md 中。"
      />

      <div className="mb-8 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索技能…"
            className="h-8 w-full rounded-lg border border-input bg-background pr-2 pl-8 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        needle ? (
          <SettingsSection title="已发现的技能">
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              没有匹配的技能。
            </div>
          </SettingsSection>
        ) : (
          <SettingsSection title="已发现的技能">
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              当前打开的项目中没有发现技能。
            </div>
          </SettingsSection>
        )
      ) : (
        grouped.map(([scope, entries]) => (
          <SettingsSection key={scope} title={`${SCOPE_LABELS[scope] ?? scope}技能`}>
            {entries.map((skill) => (
              <SettingRow
                key={skill.path}
                label={skill.interface?.displayName?.trim() || skill.name}
                description={
                  <span className="flex flex-col gap-1">
                    <span>{skillSummary(skill) || "（无描述）"}</span>
                    <code className="block truncate font-mono text-[11px]">{skill.path}</code>
                  </span>
                }
                control={
                  isBusy(skill.path) ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Switch
                      checked={skill.enabled !== false}
                      onCheckedChange={(next) => void toggle(skill, next)}
                      aria-label={`启用 ${skill.name}`}
                    />
                  )
                }
              />
            ))}
          </SettingsSection>
        ))
      )}

- [ ] **Step 4: Typecheck and build**

Run: `cd codex-desktop/ui && pnpm build`

Expected: exit 0 — `tsc --noEmit` and `vite build` both succeed.

- [ ] **Step 5: Manual smoke check**

In a running dev build (`pnpm dev`), open 设置 → 技能 and confirm:
- Empty query shows the full grouped list, identical to before (grouping, sort, toggles).
- Typing a substring of a skill's display name/name, its summary, or its path filters the list; empty scopes disappear.
- A query matching nothing shows 「没有匹配的技能。」
- Clearing the query restores the full list; toggling a switch still works and re-lists.

- [ ] **Step 6: Commit**

```bash
git add codex-desktop/ui/src/components/settings/SkillsSettings.tsx
git commit -m "feat: add search to skills settings"
```
