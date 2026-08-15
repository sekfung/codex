import { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  FileDiff,
  FileSearch,
  GitBranch,
  Loader2,
  Sparkles,
  Terminal,
  Undo2,
  Users,
} from "lucide-react";

import { useStore } from "../store";
import type { ThreadState } from "../store";
import type {
  AgentMessageItem,
  CommandExecutionItem,
  FileChangeItem,
  ReasoningItem,
  ThreadItem,
  UserMessageItem,
} from "../types";
import { ApprovalCard } from "./ApprovalCard";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Implements ADR-0013's three rendering tiers. The item-state model holds
// every item type regardless of tier (see store.tsx); only rendering here is
// tiered.
const SKIPPED_TYPES = new Set([
  "dynamicToolCall",
  "sleep",
  "imageView",
  "contextCompaction",
  "hookPrompt",
  "plan",
]);

const GENERIC_TIER_TYPES = new Set(["mcpToolCall", "webSearch", "imageGeneration"]);

/// Shared column so messages, activity rows and approval cards all align on
/// one comfortable measure rather than stretching to the window width.
const COLUMN = "mx-auto w-full max-w-3xl px-6";

export function ChatStream({ threadId }: { threadId: string }) {
  const { state } = useStore();
  const thread = state.threads[threadId];

  // Distinguish "still fetching history" and "history failed to load" from
  // "this thread really is empty" — conflating them is what made selecting an
  // existing conversation look like a blank pane.
  if (thread?.historyStatus === "loading") {
    return (
      <CenteredState>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">加载对话中…</p>
      </CenteredState>
    );
  }

  if (thread?.historyStatus === "error") {
    return (
      <CenteredState>
        <p className="text-sm font-medium">无法加载该对话。</p>
        <p className="max-w-md text-center text-xs text-destructive">{thread.historyError}</p>
      </CenteredState>
    );
  }

  if (!thread || thread.itemOrder.length === 0) {
    return (
      <CenteredState>
        <Sparkles className="size-7 text-muted-foreground" />
        <p className="text-xl font-medium tracking-tight">我们应该做些什么？</p>
      </CenteredState>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-8">
      <div className={cn(COLUMN, "flex flex-col gap-5")}>
        {thread.itemOrder.map((itemId) => (
          <ItemRenderer
            key={itemId}
            item={thread.items[itemId]}
            threadId={threadId}
            turnId={thread.itemTurnIds[itemId]}
          />
        ))}
        {thread.pendingApprovals.map((approval) => (
          <ApprovalCard key={JSON.stringify(approval.requestId)} approval={approval} />
        ))}
        <WorkingRow thread={thread} />
      </div>
    </div>
  );
}

/// Live counterpart to the finished "已处理 Xs" rows: while a turn is running
/// there is otherwise nothing between the last completed item and the next
/// one. Hidden while an approval is pending — the composer's banner already
/// says what's happening then, and "working" would be misleading.
function WorkingRow({ thread }: { thread: ThreadState }) {
  const running =
    thread.activeTurnId !== null && thread.turnStatus[thread.activeTurnId] === "inProgress";
  const startedAt = thread.activeTurnStartedAtMs;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, startedAt]);

  if (!running || thread.pendingApprovals.length > 0) return null;

  const seconds = startedAt === null ? 0 : Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <Loader2 className="size-3.5 shrink-0 animate-spin" />
      <span>处理中 {formatElapsed(seconds)}</span>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">{children}</div>
  );
}

function ItemRenderer({
  item,
  threadId,
  turnId,
}: {
  item: ThreadItem;
  threadId: string;
  turnId: string | undefined;
}) {
  if (SKIPPED_TYPES.has(item.type)) {
    return null;
  }

  switch (item.type) {
    case "userMessage":
      return (
        <UserMessageView item={item as UserMessageItem} threadId={threadId} turnId={turnId} />
      );
    case "agentMessage":
      return (
        <AgentMessageView item={item as AgentMessageItem} threadId={threadId} turnId={turnId} />
      );
    case "reasoning":
      return <ReasoningView item={item as ReasoningItem} />;
    case "commandExecution":
      return <CommandExecutionView item={item as CommandExecutionItem} />;
    case "fileChange":
      return <FileChangeView item={item as FileChangeItem} />;
    // Review mode was generic-tier under ADR-0013, but `review/start` is now a
    // real entry point in the composer, so the boundary of a review is worth
    // showing properly. This is presentation only — the capability is
    // unchanged (ADR-0021).
    case "enteredReviewMode":
      return (
        <ReviewBoundary
          label={String((item as { review?: string }).review ?? "代码审查")}
          entering
        />
      );
    case "exitedReviewMode":
      return (
        <ReviewBoundary
          label={String((item as { review?: string }).review ?? "代码审查")}
          entering={false}
        />
      );
    case "collabAgentToolCall":
      // Multi-agent drill-in (ADR-0014) is an open UI question per ADR-0017 —
      // this placeholder doesn't navigate anywhere yet.
      return <GenericActivityRow Icon={Users} label="子智能体处理中…" />;
    case "subAgentActivity":
      return <GenericActivityRow Icon={Users} label={`子智能体：${String(item.kind ?? "")}`} />;
    default:
      if (GENERIC_TIER_TYPES.has(item.type)) {
        return <GenericActivityRow Icon={Sparkles} label={item.type} />;
      }
      return null;
  }
}

/// The muted single-line activity row the reference screenshots use for
/// anything that isn't a message — quiet by default so the conversation reads
/// as prose rather than as a log.
function ActivityRow({
  Icon,
  label,
  children,
  defaultOpen = false,
}: {
  Icon: typeof Terminal;
  label: React.ReactNode;
  children?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!children) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md py-0.5 text-left text-[13px] text-muted-foreground hover:text-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 overflow-hidden border-l border-border pl-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/// Marks where a review begins and ends. `review` carries the engine's own
/// user-facing hint (`CoreTurnItem::EnteredReviewMode.user_facing_hint`), so
/// it is shown verbatim rather than reworded.
function ReviewBoundary({ label, entering }: { label: string; entering: boolean }) {
  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <span className="h-px flex-1 bg-border" />
      <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <FileSearch className="size-3.5 shrink-0" />
        {entering ? label : `${label} · 已结束`}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function GenericActivityRow({ Icon, label }: { Icon: typeof Terminal; label: string }) {
  return <ActivityRow Icon={Icon} label={label} />;
}

function UserMessageView({
  item,
  threadId,
  turnId,
}: {
  item: UserMessageItem;
  threadId: string;
  turnId: string | undefined;
}) {
  // `UserInput` is a tagged union: only the `text` variant carries `text`.
  // Images/skills/mentions would otherwise render as an empty bubble, so
  // label them rather than dropping them.
  const parts = (item.content ?? []).map((entry) => {
    if (typeof entry.text === "string") return entry.text;
    switch (entry.type) {
      case "image":
      case "localImage":
        return "[image]";
      case "audio":
      case "localAudio":
        return "[audio]";
      case "skill":
        return `[skill: ${String(entry.name ?? "")}]`;
      case "mention":
        return `@${String(entry.name ?? "")}`;
      default:
        return `[${entry.type}]`;
    }
  });

  return (
    <div className="group/user flex flex-col items-end gap-1">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-secondary px-4 py-2.5 text-[15px] leading-relaxed text-secondary-foreground">
        {parts.join("\n")}
      </div>
      {threadId && turnId && <RevertAction threadId={threadId} turnId={turnId} />}
    </div>
  );
}

/// `thread/revert` from a user message: drops that turn and everything after
/// it.
///
/// Deliberately worded to say what revert does *not* do. The engine rewrites
/// conversation history only — `thread-store`'s `revert_thread` writes a new
/// rollout referencing the retained prefix and moves a pointer, never
/// touching the working tree. Someone reading "revert" as "undo the edits"
/// would otherwise assume their files had been restored when they had not.
///
/// Two-step confirm, matching the sidebar's thread delete: this is not
/// recoverable from inside the app even though the engine retains the old
/// rollout.
function RevertAction({ threadId, turnId }: { threadId: string; turnId: string }) {
  const { state, revertThread } = useStore();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `thread/revert` is rejected outright unless the thread was created with
  // `historyMode: "paginated"`, so a legacy thread can never be reverted — no
  // amount of retrying changes that. Gate on the thread's own mode rather than
  // on whether *this session* can request pagination: threads in a shared
  // `$CODEX_HOME` (ADR-0008) come from other clients and older builds, so the
  // answer is per-thread. `null` means not yet known (the thread hasn't been
  // resumed); stay optimistic there and let the engine be the authority.
  const historyMode = state.threads[threadId]?.historyMode ?? null;
  if (historyMode === "legacy") {
    return null;
  }

  async function handleRevert() {
    setBusy(true);
    setError(null);
    try {
      await revertThread(threadId, turnId);
    } catch (err) {
      // The engine rejects non-paginated threads outright ("thread/revert
      // only supports paginated threads"); surface that rather than leaving
      // the row looking inert.
      setError(String(err));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return <div className="text-xs text-destructive">回退失败：{error}</div>;
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">
          删除此消息及之后的所有对话记录？文件改动不会撤销。
        </span>
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
          取消
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={busy}
          onClick={handleRevert}
        >
          {busy ? "回退中…" : "确认回退"}
        </Button>
      </div>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="回退到此处"
          className="text-muted-foreground opacity-0 transition-opacity group-hover/user:opacity-100 focus-visible:opacity-100"
          onClick={() => setConfirming(true)}
        >
          <Undo2 />
        </Button>
      </TooltipTrigger>
      <TooltipContent>回退：删除此消息及之后的对话记录（不撤销文件改动）</TooltipContent>
    </Tooltip>
  );
}

function AgentMessageView({
  item,
  threadId,
  turnId,
}: {
  item: AgentMessageItem;
  threadId: string;
  turnId: string | undefined;
}) {
  const { forkThreadFromTurn } = useStore();
  const [copied, setCopied] = useState(false);
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);

  async function handleCopy() {
    await navigator.clipboard.writeText(item.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // ADR-0018: fork via `thread/fork`, forking *through* this message's turn
  // (`lastTurnId` is inclusive), so the new thread ends where this message is.
  async function handleFork() {
    if (!turnId || forking) return;
    setForking(true);
    setForkError(null);
    try {
      await forkThreadFromTurn(threadId, turnId);
    } catch (err) {
      setForkError(String(err));
    } finally {
      setForking(false);
    }
  }

  return (
    <div className="group/message flex flex-col gap-1">
      <div className="whitespace-pre-wrap break-words text-[15px] leading-7">{item.text}</div>
      {/* ADR-0018: copy + fork only, no thumbs up/down or other icons. */}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="复制"
              onClick={handleCopy}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "已复制" : "复制"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="分叉"
              onClick={handleFork}
              disabled={!turnId || forking}
            >
              {forking ? <Loader2 className="animate-spin" /> : <GitBranch />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {turnId ? "从此消息分叉出新对话" : "该消息尚无所属轮次，无法分叉"}
          </TooltipContent>
        </Tooltip>
      </div>
      {forkError && <div className="text-xs text-destructive">分叉失败：{forkError}</div>}
    </div>
  );
}

function ReasoningView({ item }: { item: ReasoningItem }) {
  const text = [...(item.summary ?? []), ...(item.content ?? [])].join("\n\n");
  return (
    <ActivityRow Icon={Sparkles} label="思考过程">
      <div className="whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">{text}</div>
    </ActivityRow>
  );
}

// Reference screenshots show tool-call/reasoning activity collapsed by
// default under an elapsed-time "已处理 Xm Ys" header, with the final
// AgentMessage shown expanded — this replicates that grouping shape for a
// single CommandExecution item; exact multi-item-per-turn grouping is left
// for a follow-up pass.
function CommandExecutionView({ item }: { item: CommandExecutionItem }) {
  // `item/started` puts this row on screen before any output exists, so the
  // running case needs its own label rather than leaking the raw status enum.
  const running = item.status === "inProgress";
  const label = running
    ? "运行命令中…"
    : `已处理 ${item.durationMs != null ? `${Math.round(item.durationMs / 1000)}s` : item.status}`;

  return (
    // Expanded while running so streamed output (`item/commandExecution/outputDelta`)
    // is visible as it arrives; collapses back to a quiet row once finished.
    <ActivityRow Icon={Terminal} label={label} defaultOpen={running}>
      <div className="flex flex-col gap-2">
        <code className="block overflow-x-auto rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
          {item.command}
        </code>
        {item.aggregatedOutput && (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
            {item.aggregatedOutput}
          </pre>
        )}
      </div>
    </ActivityRow>
  );
}

function FileChangeView({ item }: { item: FileChangeItem }) {
  const changes = item.changes ?? [];
  return (
    <ActivityRow
      Icon={FileDiff}
      label={`文件改动 · ${changes.length} 个文件 · ${item.status}`}
    >
      <ul className="flex flex-col gap-2">
        {changes.map((change, index) => (
          <li key={index} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                {change.kind?.type ?? "update"}
              </span>
              <span className="truncate font-mono">{change.path}</span>
            </div>
            {change.diff && (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
                {change.diff}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </ActivityRow>
  );
}
