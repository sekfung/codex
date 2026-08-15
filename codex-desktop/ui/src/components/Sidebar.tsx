import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Folder,
  Loader2,
  MessageSquarePlus,
  Monitor,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";

import { useStore } from "../store";
import * as api from "../api";
import { threadTitle } from "../types";
import type { ThreadSummary } from "../types";
import { useTheme } from "../useTheme";
import type { ThemeMode } from "../useTheme";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountFooter } from "./AccountFooter";
import { cn } from "@/lib/utils";

const THEME_MODES: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: "system", label: "跟随系统", Icon: Monitor },
  { mode: "light", label: "浅色", Icon: Sun },
  { mode: "dark", label: "深色", Icon: Moon },
];

// Left rail, following the Official App's sidebar structure (ADR-0005 single
// window + internal Project switcher; CONTEXT.md's "Project" term).
export function Sidebar() {
  const { state, setActiveProject, addProject, removeProject, openSettings, exitSearch } =
    useStore();
  const { mode, setMode } = useTheme();
  const [manualPath, setManualPath] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  /// Inline rather than a notice: the user is looking at these controls when
  /// it fails, and a rejected path (not a directory, no permission) is about
  /// the input right here. Silently doing nothing was the previous behavior.
  const [addError, setAddError] = useState<string | null>(null);

  const searching = searchOpen || state.search.term.length > 0;

  async function handlePickFolder() {
    setAddError(null);
    try {
      const path = await api.pickProjectFolder();
      if (path) await addProject(path);
    } catch (err) {
      setAddError(String(err));
    }
  }

  async function handleAddManualPath() {
    const path = manualPath.trim();
    if (!path) return;
    setAddError(null);
    try {
      await addProject(path);
      setManualPath("");
    } catch (err) {
      // The path stays in the box so the user can correct it rather than
      // retype it.
      setAddError(String(err));
    }
  }

  function closeSearch() {
    setSearchOpen(false);
    exitSearch();
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="搜索对话"
                aria-pressed={searching}
                className={cn(searching && "bg-sidebar-accent text-foreground")}
                onClick={() => (searching ? closeSearch() : setSearchOpen(true))}
              >
                <Search />
              </Button>
            </TooltipTrigger>
            <TooltipContent>搜索对话</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {searching ? (
        <SearchPane onClose={closeSearch} />
      ) : (
        <>
          <nav className="px-2 pb-2">
            <NewThreadNavItem />
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
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={handlePickFolder}
              >
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
              {addError && (
                <p className="px-1 text-xs break-words text-destructive">{addError}</p>
              )}
            </div>
          </div>
        </>
      )}

      <footer className="flex items-center justify-between gap-2 border-t border-sidebar-border px-3 py-2.5">
        <AccountFooter />
        <div className="flex shrink-0 items-center gap-0.5">
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

/// Starts a thread in the active Project. Disabled — with the reason stated —
/// when no Project is selected, rather than silently doing nothing.
function NewThreadNavItem() {
  const { state, startNewThread } = useStore();
  const path = state.activeProjectPath;
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (!path || busy) return;
    setBusy(true);
    try {
      await startNewThread(path);
    } finally {
      setBusy(false);
    }
  }

  const button = (
    <button
      type="button"
      disabled={!path || busy}
      onClick={handleClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm",
        path ? "hover:bg-sidebar-accent" : "cursor-not-allowed opacity-50",
      )}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <MessageSquarePlus className="size-4 text-muted-foreground" />
      )}
      新对话
    </button>
  );

  if (path) return button;
  return (
    <Tooltip>
      {/* A disabled <button> swallows pointer events, so the tooltip needs a
          wrapper to hang off of. */}
      <TooltipTrigger asChild>
        <span className="block">{button}</span>
      </TooltipTrigger>
      <TooltipContent>先在下方选择一个项目</TooltipContent>
    </Tooltip>
  );
}

/// Search replaces the Project tree while active. Results come from
/// `thread/search`, which spans every Project — so each row names the folder
/// it belongs to.
function SearchPane({ onClose }: { onClose: () => void }) {
  const { state, setSearchTerm, setActiveThread } = useStore();
  const { term, status, results, error } = state.search;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2">
      <div className="flex items-center gap-1 px-1 pt-1 pb-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={term}
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
            }}
            placeholder="搜索对话…"
            className="h-8 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="退出搜索" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {term.trim().length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">输入关键词以搜索全部对话。</p>
        ) : status === "searching" ? (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            搜索中…
          </div>
        ) : status === "error" ? (
          <p className="px-3 py-2 text-xs text-destructive">搜索失败：{error}</p>
        ) : results.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">没有匹配的对话。</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {results.map((result) => (
              <li key={result.thread.id}>
                <button
                  type="button"
                  onClick={() => void setActiveThread(result.thread.id)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-lg px-3 py-1.5 text-left",
                    state.activeThreadId === result.thread.id
                      ? "bg-sidebar-accent"
                      : "hover:bg-sidebar-accent/60",
                  )}
                >
                  <span className="truncate text-[13px]">{threadTitle(result.thread)}</span>
                  {result.snippet && (
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {result.snippet}
                    </span>
                  )}
                  {result.thread.cwd && (
                    <span className="truncate text-[11px] text-muted-foreground/70">
                      {result.thread.cwd}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
  const { state, startNewThread, setArchivedVisible } = useStore();
  const threads = state.threadsByProject[projectPath] ?? [];
  const archived = state.archivedThreadsByProject[projectPath] ?? [];
  const archivedOpen = state.archivedVisible[projectPath] ?? false;

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
            threads.map((thread) => <ThreadRow key={thread.id} thread={thread} />)
          )}

          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
            onClick={() => startNewThread(projectPath)}
          >
            <Plus className="size-3.5" />
            新对话
          </button>

          {/* The archived view exists so `thread/unarchive` stays reachable —
              without it, archiving would be a one-way trip with no undo. */}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
            onClick={() => void setArchivedVisible(projectPath, !archivedOpen)}
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", archivedOpen && "rotate-90")}
            />
            已归档
          </button>

          {archivedOpen &&
            (archived.length === 0 ? (
              <div className="px-3 py-1 pl-8 text-xs text-muted-foreground">没有已归档的对话</div>
            ) : (
              archived.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} archived className="pl-5" />
              ))
            ))}
        </div>
      )}
    </li>
  );
}

function ThreadRow({
  thread,
  archived = false,
  className,
}: {
  thread: ThreadSummary;
  archived?: boolean;
  className?: string;
}) {
  const {
    state,
    setActiveThread,
    renameThread,
    archiveThread,
    unarchiveThread,
    deleteThread,
  } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const title = threadTitle(thread);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      // Kept on screen: a failed archive/delete that looked like it worked
      // would be worse than a visible error.
      setError(String(err));
    }
  }

  if (renaming) {
    return (
      <div className={cn("px-3 py-1", className)}>
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setRenaming(false);
            if (event.key === "Enter") {
              const name = draft.trim();
              setRenaming(false);
              if (name && name !== thread.name) void run(() => renameThread(thread.id, name));
            }
          }}
          className="h-7 w-full rounded-md border border-input bg-background px-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    );
  }

  return (
    <div className={cn("group/thread relative", className)}>
      <div
        className={cn(
          "flex items-center gap-1 rounded-lg pr-1",
          state.activeThreadId === thread.id
            ? "bg-sidebar-accent text-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        )}
      >
        <button
          type="button"
          title={thread.preview || title}
          className="min-w-0 flex-1 truncate px-3 py-1.5 text-left text-[13px]"
          onClick={() => void setActiveThread(thread.id)}
        >
          {title}
        </button>

        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          align="end"
          trigger={
            <button
              type="button"
              aria-label="对话操作"
              className={cn(
                "shrink-0 rounded p-1 opacity-0 transition-opacity hover:text-foreground",
                "group-hover/thread:opacity-100 focus-visible:opacity-100",
                menuOpen && "opacity-100",
              )}
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          }
        >
          {(close) => (
            <ThreadMenuContent
              archived={archived}
              onRename={() => {
                close();
                setDraft(thread.name ?? "");
                setRenaming(true);
              }}
              onArchive={() => {
                close();
                void run(() => archiveThread(thread.id));
              }}
              onUnarchive={() => {
                close();
                void run(() => unarchiveThread(thread.id));
              }}
              onDelete={() => {
                close();
                void run(() => deleteThread(thread.id));
              }}
            />
          )}
        </Menu>
      </div>
      {error && <div className="px-3 pb-1 text-[11px] text-destructive">{error}</div>}
    </div>
  );
}

/// Delete confirms in place rather than in a dialog — there's no dialog
/// primitive here (see `menu.tsx`), and a two-step menu keeps the destructive
/// action from being one stray click away.
function ThreadMenuContent({
  archived,
  onRename,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  archived: boolean;
  onRename: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (confirmingDelete) {
    return (
      <>
        <MenuLabel>删除后无法恢复，确定吗？</MenuLabel>
        <MenuItem destructive onClick={onDelete}>
          <Trash2 className="size-3.5" />
          确认删除
        </MenuItem>
        <MenuItem onClick={() => setConfirmingDelete(false)}>取消</MenuItem>
      </>
    );
  }

  return (
    <>
      <MenuItem onClick={onRename}>
        <Pencil className="size-3.5" />
        重命名
      </MenuItem>
      {archived ? (
        <MenuItem onClick={onUnarchive}>
          <ArchiveRestore className="size-3.5" />
          取消归档
        </MenuItem>
      ) : (
        <MenuItem onClick={onArchive}>
          <Archive className="size-3.5" />
          归档
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem destructive onClick={() => setConfirmingDelete(true)}>
        <Trash2 className="size-3.5" />
        删除
      </MenuItem>
    </>
  );
}
