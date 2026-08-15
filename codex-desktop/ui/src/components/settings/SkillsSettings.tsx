import { useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";

import * as api from "../../api";
import { useStore } from "../../store";
import { useAsyncAction } from "./useAsyncAction";
import type { SkillMetadata } from "../../types";
import { skillSummary } from "../../types";
import { SettingRow, SettingsHeader, SettingsSection } from "./SettingsPrimitives";
import { Switch } from "@/components/ui/switch";

// Skills (`skills/list` + `skills/config/write`).
//
// `skills/config/write` permits exactly one change — enabling or disabling a
// skill, selected by path or name — so that is the only control here. Anything
// else about a skill is defined by its own SKILL.md/SKILL.json on disk and has
// no write RPC (ADR-0021).
//
// Nav placement under 编码 is *our* choice, not copied: the reference
// screenshots' settings nav is cut off below 环境, so they never show whether
// the Official App has a Skills entry or where it puts one. Presentation is
// free under ADR-0021 test 2; this note exists so nobody later "corrects" the
// placement against a screenshot that does not cover it.

const SCOPE_LABELS: Record<string, string> = {
  user: "用户",
  repo: "仓库",
  system: "系统",
  admin: "管理员",
};

export function SkillsSettings() {
  const { state, refetchSkills } = useStore();
  const { isBusy, error, setError, run } = useAsyncAction();

  // `skills/list` already runs at startup and whenever the Project set
  // changes, so an empty catalog here is normally genuine rather than "not
  // loaded yet". One refresh on open still costs little and covers a missed
  // `skills/changed`.
  useEffect(() => {
    refetchSkills();
  }, [refetchSkills]);

  // The store holds the full catalog (including disabled skills) precisely so
  // this screen can offer re-enabling; the `$` typeahead filters instead.
  const skills = state.skills;

  // Grouped by scope so a repo-local skill is visibly different from a
  // system-wide one — the same skill name can exist in both.
  const grouped = useMemo(() => {
    const byScope = new Map<string, SkillMetadata[]>();
    for (const skill of skills) {
      const list = byScope.get(skill.scope) ?? [];
      list.push(skill);
      byScope.set(skill.scope, list);
    }
    for (const list of byScope.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...byScope.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [skills]);

  async function toggle(skill: SkillMetadata, enabled: boolean) {
    await run(
      async () => {
      const effective = await api.setSkillEnabled(skill.path, enabled);
      if (effective !== enabled) {
        // The server accepted the write but a higher config layer pins the
        // skill, so the effective state is not what was asked for. Saying so
        // is better than letting the toggle spring back with no explanation.
        setError(
          `${skill.name} 的启用状态由更高优先级的配置层决定，实际仍为${effective ? "启用" : "停用"}。`,
        );
      }
      // Re-list rather than patching local state: the effective value is the
      // server's to decide, and `skills/list` is where it is reported.
      refetchSkills();
      },
      { key: skill.path },
    );
  }

  return (
    <>
      <SettingsHeader
        title="技能"
        description="技能是 Codex 可以按需加载的指令集，在对话框中用 $ 引用。这里只能启用或停用它们 — 技能内容定义在各自的 SKILL.md 中。"
      />

      {grouped.length === 0 ? (
        <SettingsSection title="已发现的技能">
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            当前打开的项目中没有发现技能。
          </div>
        </SettingsSection>
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

      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}
