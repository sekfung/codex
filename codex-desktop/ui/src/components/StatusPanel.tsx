import { useState } from "react";
import { Info } from "lucide-react";

import { useStore } from "../store";
import * as api from "../api";
import { threadTitle } from "../types";
import type { BranchStatus, ThreadSummary } from "../types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * `/status` — "show current session configuration and token usage".
 *
 * Assembled entirely from state this client already holds: model and effort
 * (`model/list` + the composer's selection), collaboration mode, personality,
 * context usage (`thread/tokenUsage/updated`) and the thread's own identity.
 * No new RPC — the TUI's status card reads the same set from its session
 * state, and assembling it is presentation (ADR-0021 test 2).
 */
export function StatusPanel({ threadId }: { threadId: string }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const [git, setGit] = useState<BranchStatus | null>(null);

  const thread = state.threads[threadId];
  const summary = findThread(state.threadsByProject, threadId);
  const model = state.models.find((entry) => entry.model === state.modelSelection.model);
  const usage = thread?.contextUsage ?? null;

  // Read when the panel opens, not on mount: this runs git, and the panel is
  // opened far less often than the chat renders. A failure leaves the section
  // absent rather than reporting an error — the rest of the status is still
  // worth showing, and the git rows are supplementary.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    const cwd = summary?.cwd ?? state.activeProjectPath;
    if (!cwd) return;
    void api
      .branchStatus(cwd)
      .then(setGit)
      .catch(() => setGit(null));
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" title="会话状态">
          <Info />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="mb-2 text-[13px] font-medium">会话状态</div>

        <Section title="对话">
          <Row label="标题" value={summary ? threadTitle(summary) : "—"} />
          <Row label="ID" value={threadId} mono />
          {summary?.cwd && <Row label="目录" value={summary.cwd} mono />}
        </Section>

        {/* Omitted entirely outside a repository rather than shown as "—":
            "this thread is not in a repo" is not a status worth a row. */}
        {git?.isGitRepo && (
          <Section title="Git">
            <Row label="分支" value={git.branch ?? "（游离 HEAD）"} mono={Boolean(git.branch)} />
            {git.defaultBranch && git.branch !== git.defaultBranch && git.changes && (
              <Row
                label={`相对 ${git.defaultBranch}`}
                value={`+${git.changes.additions} −${git.changes.deletions}`}
                mono
              />
            )}
          </Section>
        )}

        <Section title="模型">
          <Row label="模型" value={model?.displayName ?? state.modelSelection.model ?? "默认"} />
          {state.modelSelection.effort && (
            <Row label="推理强度" value={state.modelSelection.effort} />
          )}
          <Row label="协作模式" value={state.collaborationMode} />
          {state.personality && <Row label="沟通风格" value={state.personality} />}
        </Section>

        <Section title="上下文">
          {usage ? (
            <>
              {usage.percentRemaining !== null && (
                <Row label="剩余" value={`${usage.percentRemaining}%`} />
              )}
              <Row label="已用" value={`${usage.usedTokens.toLocaleString()} tokens`} />
            </>
          ) : (
            // A thread with no completed turn genuinely has no usage; showing
            // zero would imply the engine reported it.
            <Row label="用量" value="尚未开始统计" />
          )}
        </Section>
      </PopoverContent>
    </Popover>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-[11px] text-muted-foreground">{title}</div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={mono ? "truncate font-mono" : "truncate"} title={value}>
        {value}
      </span>
    </div>
  );
}

function findThread(
  threadsByProject: Record<string, ThreadSummary[]>,
  threadId: string,
): ThreadSummary | null {
  for (const threads of Object.values(threadsByProject)) {
    const match = threads.find((thread) => thread.id === threadId);
    if (match) return match;
  }
  return null;
}
