import { useState } from "react";
import { GitCompare, Loader2, RefreshCw } from "lucide-react";

import { useStore } from "../store";
import * as api from "../api";
import type { GitDiffResult, ThreadSummary } from "../types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/// `/diff` — the working-tree diff, including untracked files.
///
/// Run on demand rather than kept live: it is a git invocation over
/// `command/exec`, not a subscription, and the TUI's `/diff` is likewise a
/// command the user asks for.
///
/// Not to be confused with `turn/diff/updated`, which reports a turn's
/// cumulative diff. The TUI receives that notification and does nothing with
/// the payload (`on_turn_diff` only refreshes its status line), so it is not
/// the basis for this feature.
export function DiffViewer({ threadId }: { threadId: string }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GitDiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Diff the repository this thread actually belongs to, which is its own
  // `cwd` from `thread/list` — not simply the selected Project. Those differ
  // whenever a thread was opened from search, since `thread/search` spans
  // every Project. The Project path is only the fallback.
  const cwd = threadCwd(state.threadsByProject, threadId) ?? state.activeProjectPath;

  async function load() {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await api.gitDiff(cwd));
    } catch (err) {
      // Surfaced rather than logged: the user pressed a button and nothing
      // else would tell them it failed.
      setError(String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Re-read on every open: the working tree changes underneath this, and a
    // stale diff is worse than a slow one.
    if (next) void load();
  }

  if (!cwd) return null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" title="查看改动 (git diff)">
          <GitCompare />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(46rem,calc(100vw-3rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-[13px] font-medium">工作区改动</span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            disabled={loading}
            title="重新读取"
            onClick={() => void load()}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </div>
        <div className="max-h-[26rem] overflow-auto p-3">
          <DiffBody loading={loading} error={error} result={result} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DiffBody({
  loading,
  error,
  result,
}: {
  loading: boolean;
  error: string | null;
  result: GitDiffResult | null;
}) {
  if (loading && !result) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        正在读取…
      </div>
    );
  }
  if (error) return <p className="text-xs text-destructive">读取失败：{error}</p>;
  if (!result) return null;
  // "Not a repository" and "no changes" are different answers; conflating
  // them would tell a user outside a repo that their work is committed.
  if (!result.isGitRepo) {
    return <p className="text-xs text-muted-foreground">该目录不是 git 仓库。</p>;
  }
  if (result.diff.trim() === "") {
    return <p className="text-xs text-muted-foreground">工作区干净，没有改动。</p>;
  }
  return <DiffText diff={result.diff} />;
}

/// Renders the diff with per-line colouring.
///
/// Git is asked for `--color`, so the payload carries ANSI escapes. They are
/// stripped and the prefix re-read here instead of parsing the escapes: the
/// prefix is what actually determines the line's meaning, and leaving raw
/// escapes in the DOM would render as mojibake.
function DiffText({ diff }: { diff: string }) {
  const lines = stripAnsi(diff).split("\n");
  return (
    <pre className="overflow-x-auto font-mono text-xs leading-5">
      {lines.map((line, index) => (
        <div key={index} className={cn("whitespace-pre", lineClass(line))}>
          {line === "" ? " " : line}
        </div>
      ))}
    </pre>
  );
}

/// Finds a thread's own `cwd` across the per-Project lists.
function threadCwd(
  threadsByProject: Record<string, ThreadSummary[]>,
  threadId: string,
): string | null {
  for (const threads of Object.values(threadsByProject)) {
    const match = threads.find((thread) => thread.id === threadId);
    if (match?.cwd) return match.cwd;
  }
  return null;
}

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-muted-foreground";
  if (line.startsWith("@@")) return "text-primary";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "text-muted-foreground";
  if (line.startsWith("+")) return "text-emerald-600 dark:text-emerald-400";
  if (line.startsWith("-")) return "text-red-600 dark:text-red-400";
  return "";
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}
