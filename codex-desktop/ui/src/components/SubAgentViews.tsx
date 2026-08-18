import { Bot, CornerDownRight } from "lucide-react";

import { useStore } from "../store";
import type {
  CollabAgentState,
  CollabAgentToolCallItem,
  SubAgentActivityItem,
} from "../types";
import { cn } from "@/lib/utils";

/**
 * Multi-agent stream rendering (ADR-0014).
 *
 * Phrasing and, more importantly, *which calls render at all* follow the TUI's
 * `multi_agents.rs::tool_call_history_cell` rather than a model invented here.
 * The one thing this adds is navigation: each row that names an agent thread
 * can open it, which ADR-0017 left as the remaining question.
 */

const AGENT_STATUS_TEXT: Record<CollabAgentState["status"], string> = {
  pendingInit: "准备中",
  running: "运行中",
  interrupted: "已中断",
  completed: "已完成",
  errored: "出错",
  shutdown: "已关闭",
  notFound: "找不到",
};

/** Errored and interrupted are the states worth colouring; the rest are noise. */
function statusTone(status: CollabAgentState["status"]): string {
  if (status === "errored" || status === "notFound") return "text-destructive";
  if (status === "interrupted") return "text-amber-600 dark:text-amber-500";
  return "text-muted-foreground";
}

/**
 * A clickable agent reference. Falls back to a shortened thread id when the
 * label lookup hasn't resolved — never the bare UUID at full length, which
 * tells the reader nothing and wraps badly.
 */
function AgentLink({
  threadId,
  fromThreadId,
  label,
}: {
  threadId: string;
  fromThreadId: string;
  label?: string;
}) {
  const { drillIntoThread } = useStore();
  return (
    <button
      type="button"
      className="rounded font-medium text-primary underline-offset-2 hover:underline"
      title="打开该子智能体的对话"
      onClick={() => void drillIntoThread(threadId, fromThreadId, "subAgent")}
    >
      {label ?? `智能体 ${threadId.slice(0, 8)}`}
    </button>
  );
}

function AgentStateList({
  states,
  fromThreadId,
}: {
  states: Record<string, CollabAgentState>;
  fromThreadId: string;
}) {
  const entries = Object.entries(states);
  if (entries.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {entries.map(([threadId, state]) => (
        <li key={threadId} className="flex items-start gap-1.5 text-xs">
          <CornerDownRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          <AgentLink threadId={threadId} fromThreadId={fromThreadId} />
          <span className={cn("shrink-0", statusTone(state.status))}>
            {AGENT_STATUS_TEXT[state.status] ?? state.status}
          </span>
          {state.message && (
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{state.message}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col text-[13px] text-muted-foreground">
      <div className="flex items-start gap-2">
        <Bot className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export function CollabAgentToolCallView({
  item,
  threadId,
}: {
  item: CollabAgentToolCallItem;
  /** The thread this item is rendered in — the way back from any drill-in. */
  threadId: string;
}) {
  // `senderThreadId` is the agent that issued the call, which for a nested
  // agent is not the thread being viewed. Returning should go back to where
  // the user actually is.
  const from = threadId;
  const receivers = item.receiverThreadIds ?? [];
  const first = receivers[0];
  const running = item.status === "inProgress";
  const failed = item.status === "failed";
  const states = item.agentsStates ?? {};

  // The TUI hides spawn/sendInput/close while they are in flight and renders
  // only their outcome; wait and resume are the two it narrates as they run.
  // Following that keeps a burst of collab calls from flooding the stream.
  if (running && (item.tool === "spawnAgent" || item.tool === "sendInput" || item.tool === "closeAgent")) {
    return null;
  }

  const agent = first ? <AgentLink threadId={first} fromThreadId={from} /> : <span>子智能体</span>;

  switch (item.tool) {
    case "spawnAgent":
      return (
        <Row>
          <span>
            {failed ? "启动子智能体失败：" : "已启动子智能体 "}
            {agent}
            {item.model && <span className="ml-1 text-xs">（{item.model}</span>}
            {item.model && item.reasoningEffort && <span className="text-xs">·{item.reasoningEffort}</span>}
            {item.model && <span className="text-xs">）</span>}
          </span>
          {item.prompt && (
            <div className="mt-1 line-clamp-3 text-xs italic text-muted-foreground/80">
              {item.prompt}
            </div>
          )}
        </Row>
      );
    case "sendInput":
      return (
        <Row>
          <span>
            {failed ? "向子智能体发送输入失败：" : "已向 "}
            {agent}
            {!failed && " 发送输入"}
          </span>
          {item.prompt && (
            <div className="mt-1 line-clamp-3 text-xs italic text-muted-foreground/80">
              {item.prompt}
            </div>
          )}
        </Row>
      );
    case "resumeAgent":
      return (
        <Row>
          <span>
            {running ? "正在恢复 " : failed ? "恢复失败：" : "已恢复 "}
            {agent}
          </span>
          <AgentStateList states={states} fromThreadId={from} />
        </Row>
      );
    case "wait":
      return (
        <Row>
          <span>{running ? "正在等待子智能体…" : "子智能体已返回"}</span>
          <AgentStateList states={states} fromThreadId={from} />
        </Row>
      );
    case "closeAgent":
      return (
        <Row>
          <span>
            {failed ? "关闭子智能体失败：" : "已关闭 "}
            {agent}
          </span>
        </Row>
      );
    default:
      // An upstream-added tool: name it rather than dropping the row, so a new
      // collab operation is visible even before this client understands it.
      return (
        <Row>
          <span>子智能体操作：{String(item.tool)}</span>
        </Row>
      );
  }
}

const ACTIVITY_TEXT: Record<SubAgentActivityItem["kind"], (path: string) => string> = {
  started: (path) => `已启动 ${path}`,
  interacted: (path) => `与 ${path} 交互`,
  interrupted: (path) => `已中断 ${path}`,
};

export function SubAgentActivityView({
  item,
  threadId,
}: {
  item: SubAgentActivityItem;
  threadId: string;
}) {
  const path = item.agentPath || "子智能体";
  const text = ACTIVITY_TEXT[item.kind]?.(path) ?? `${item.kind} ${path}`;
  return (
    <Row>
      <span className="flex items-center gap-1.5">
        <span className="truncate">{text}</span>
        {item.agentThreadId && (
          <AgentLink threadId={item.agentThreadId} fromThreadId={threadId} label="查看" />
        )}
      </span>
    </Row>
  );
}
