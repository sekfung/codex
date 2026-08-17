import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  Blocks,
  Brain,
  FlaskConical,
  GitBranch,
  Keyboard,
  Palette,
  Plug,
  Search,
  Settings2,
  Sliders,
  Sparkles,
  Terminal,
  User,
  Webhook,
} from "lucide-react";

import { useStore } from "../../store";
import { GeneralSettings } from "./GeneralSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { ConfigSettings } from "./ConfigSettings";
import { ImportSettings } from "./ImportSettings";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { HooksSettings } from "./HooksSettings";
import { MemoriesSettings } from "./MemoriesSettings";
import { PluginsSettings } from "./PluginsSettings";
import { SkillsSettings } from "./SkillsSettings";
import { EnvironmentSettings } from "./EnvironmentSettings";
import { GitSettings } from "./GitSettings";
import { ExperimentalSettings } from "./ExperimentalSettings";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Full-window takeover with its own rail, matching the Official App's
// settings surface (reference screenshots 02-04) — not a modal.

interface NavItem {
  id: string;
  label: string;
  Icon: typeof User;
  /**
   * Entries with no screen yet render disabled rather than as dead links.
   * These are still v1 scope per ADR-0006 — they're the next increment, not
   * abandoned. Anything ADR-0006 *excludes* (computer control, browser,
   * voice, cloud tasks, remote control) is absent entirely.
   */
  ready?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "个人",
    items: [
      { id: "general", label: "常规", Icon: Settings2, ready: true },
      { id: "import", label: "导入", Icon: Download, ready: true },
      { id: "appearance", label: "外观", Icon: Palette, ready: true },
      { id: "config", label: "配置", Icon: Sliders, ready: true },
      { id: "memories", label: "记忆", Icon: Brain, ready: true },
      { id: "keyboard", label: "键盘快捷键", Icon: Keyboard },
    ],
  },
  {
    label: "集成",
    items: [
      { id: "plugins", label: "插件", Icon: Blocks, ready: true },
      { id: "connections", label: "连接", Icon: Plug, ready: true },
    ],
  },
  {
    label: "编码",
    items: [
      // 技能's placement here is our choice, not copied — the reference
      // screenshots' nav is cut off below 环境, so they never show whether the
      // Official App has a Skills entry at all. See SkillsSettings.tsx.
      { id: "skills", label: "技能", Icon: Sparkles, ready: true },
      { id: "hooks", label: "钩子", Icon: Webhook, ready: true },
      // Also our placement: `/experimental` is a TUI command with no nav
      // counterpart in the screenshots. See ExperimentalSettings.tsx.
      { id: "experimental", label: "实验性功能", Icon: FlaskConical, ready: true },
      // Enabled, but as an explanatory screen rather than a control panel:
      // none of the Official App's seven Git controls has a config key or RPC
      // in this repo. See GitSettings.tsx for the per-control finding.
      { id: "git", label: "Git", Icon: GitBranch, ready: true },
      { id: "environment", label: "环境", Icon: Terminal, ready: true },
    ],
  },
];

export function SettingsShell() {
  const { state, closeSettings, openSettings } = useStore();
  const [query, setQuery] = useState("");
  const active = state.settingsScreen ?? "general";

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return NAV_GROUPS;
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(needle)),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
      <aside className="flex h-full w-[276px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="px-3 pt-3.5 pb-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={closeSettings}
          >
            <ArrowLeft />
            返回应用
          </Button>
        </div>

        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索设置..."
              className="h-8 w-full rounded-lg border border-input bg-background pr-2 pl-8 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="px-3 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">
                {group.label}
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={!item.ready}
                      title={item.ready ? undefined : "敬请期待"}
                      onClick={() => openSettings(item.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm",
                        item.ready
                          ? active === item.id
                            ? "bg-sidebar-accent font-medium"
                            : "hover:bg-sidebar-accent/60"
                          : "cursor-not-allowed text-muted-foreground/60",
                      )}
                    >
                      <item.Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {!item.ready && (
                        <span className="shrink-0 text-[10px] text-muted-foreground/70">
                          敬请期待
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-10 py-12">
          {active === "general" && <GeneralSettings />}
          {active === "appearance" && <AppearanceSettings />}
          {active === "config" && <ConfigSettings />}
          {active === "import" && <ImportSettings />}
          {active === "plugins" && <PluginsSettings />}
          {active === "connections" && <ConnectionsSettings />}
          {active === "hooks" && <HooksSettings />}
          {active === "memories" && <MemoriesSettings />}
          {active === "skills" && <SkillsSettings />}
          {active === "experimental" && <ExperimentalSettings />}
          {active === "environment" && <EnvironmentSettings />}
          {active === "git" && <GitSettings />}
        </div>
      </main>
    </div>
  );
}
