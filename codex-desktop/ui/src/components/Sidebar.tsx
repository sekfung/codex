import { useState } from "react";
import {
  ChevronDown,
  Folder,
  MessageSquarePlus,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  X,
} from "lucide-react";

import { useStore } from "../store";
import * as api from "../api";
import { useTheme } from "../useTheme";
import type { ThemeMode } from "../useTheme";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const THEME_MODES: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: "system", label: "跟随系统", Icon: Monitor },
  { mode: "light", label: "浅色", Icon: Sun },
  { mode: "dark", label: "深色", Icon: Moon },
];

// Left rail, following the Official App's sidebar structure (ADR-0005 single
// window + internal Project switcher; CONTEXT.md's "Project" term).
export function Sidebar() {
  const { state, setActiveProject, addProject, removeProject, openSettings } = useStore();
  const { mode, setMode } = useTheme();
  const [manualPath, setManualPath] = useState("");

  async function handlePickFolder() {
    const path = await api.pickProjectFolder();
    if (path) await addProject(path);
  }

  async function handleAddManualPath() {
    const path = manualPath.trim();
    if (!path) return;
    await addProject(path);
    setManualPath("");
  }

  return (
    <aside className="flex h-full w-[276px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <header className="flex items-center justify-between px-4 pt-4 pb-2">
        <button
          type="button"
          className="-ml-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-[15px] font-semibold hover:bg-sidebar-accent"
        >
          Codex
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
        <div className="flex items-center gap-0.5 text-muted-foreground">
          <Button variant="ghost" size="icon-sm" aria-label="搜索">
            <Search />
          </Button>
        </div>
      </header>

      <nav className="px-2 pb-2">
        <SidebarNavItem Icon={MessageSquarePlus} label="新对话" />
      </nav>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
        <SectionLabel>项目</SectionLabel>
        {state.projects.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">还没有打开任何项目。</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {state.projects.map((project) => (
              <ProjectRow
                key={project.id}
                projectPath={project.path}
                name={project.name}
                active={state.activeProjectPath === project.path}
                onSelect={() => setActiveProject(project.path)}
                onRemove={() => removeProject(project.id)}
              />
            ))}
          </ul>
        )}

        <div className="mt-2 flex flex-col gap-1.5 px-1 pb-3">
          <Button variant="ghost" size="sm" className="justify-start" onClick={handlePickFolder}>
            <Plus />
            打开文件夹…
          </Button>
          {/* Fallback for environments where the native dialog can't run
              (e.g. a sandbox with no display server) — not in the Official
              App, purely a dev convenience. */}
          <div className="flex items-center gap-1">
            <input
              value={manualPath}
              onChange={(event) => setManualPath(event.target.value)}
              placeholder="/absolute/path/to/repo"
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleAddManualPath();
              }}
            />
            <Button variant="outline" size="xs" onClick={handleAddManualPath}>
              添加
            </Button>
          </div>
        </div>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-sidebar-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-medium text-background">
            C
          </span>
          <span className="truncate text-xs text-muted-foreground">Codex Desktop</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="设置"
                className="text-muted-foreground"
                onClick={() => openSettings()}
              >
                <Settings />
              </Button>
            </TooltipTrigger>
            <TooltipContent>设置</TooltipContent>
          </Tooltip>
          {THEME_MODES.map(({ mode: candidate, label, Icon }) => (
            <Tooltip key={candidate}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={label}
                  aria-pressed={candidate === mode}
                  className={cn(
                    "text-muted-foreground",
                    candidate === mode && "bg-sidebar-accent text-foreground",
                  )}
                  onClick={() => setMode(candidate)}
                >
                  <Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </footer>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">{children}</div>
  );
}

function SidebarNavItem({ Icon, label }: { Icon: typeof Sun; label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-sidebar-foreground">
      <Icon className="size-4 text-muted-foreground" />
      {label}
    </div>
  );
}

function ProjectRow({
  projectPath,
  name,
  active,
  onSelect,
  onRemove,
}: {
  projectPath: string;
  name: string;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { state, setActiveThread, startNewThread } = useStore();
  const threads = (state.threadsByProject[projectPath] ?? []) as Array<{
    id: string;
    preview?: string;
  }>;

  return (
    <li>
      <div
        onClick={onSelect}
        className={cn(
          "group flex cursor-default items-center gap-2 rounded-lg px-3 py-1.5 text-sm",
          active ? "bg-sidebar-accent font-medium" : "hover:bg-sidebar-accent/60",
        )}
      >
        <Folder className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <button
          type="button"
          title="从侧边栏移除"
          className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground text-muted-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {active && (
        <div className="mt-0.5 mb-1 flex flex-col gap-0.5 pl-4">
          {threads.length === 0 ? (
            <div className="px-3 py-1 text-xs text-muted-foreground">没有聊天</div>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                title={thread.preview || undefined}
                className={cn(
                  "truncate rounded-lg px-3 py-1.5 text-left text-[13px]",
                  state.activeThreadId === thread.id
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
                onClick={() => void setActiveThread(thread.id)}
              >
                {thread.preview || "(untitled)"}
              </button>
            ))
          )}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
            onClick={() => startNewThread(projectPath)}
          >
            <Plus className="size-3.5" />
            新对话
          </button>
        </div>
      )}
    </li>
  );
}
