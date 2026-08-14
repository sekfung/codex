import { useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  Hand,
  Loader2,
  Plus,
  ShieldCheck,
  Square,
} from "lucide-react";

import { useStore } from "../store";
import type { ApprovalMode, ModelSelection, ReasoningEffort } from "../types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Labels/hints mirror the Official App's selector (reference screenshots).
// The behavior each one maps to lives in Rust (`src/approval_mode.rs`), which
// resolves them against the shared built-in approval presets.
const APPROVAL_MODES: Array<{
  value: ApprovalMode;
  label: string;
  hint: string;
  Icon: typeof Hand;
  tone?: "warning";
}> = [
  {
    value: "requestApproval",
    label: "请求批准",
    hint: "编辑外部文件和使用互联网时始终询问",
    Icon: Hand,
  },
  {
    value: "helpMeApprove",
    label: "帮我批准",
    hint: "仅对检测到的风险操作请求批准",
    Icon: ShieldCheck,
  },
  {
    value: "fullAccess",
    label: "完全访问权限",
    hint: "可不受限制地访问互联网和您电脑上的任何文件",
    Icon: CircleAlert,
    tone: "warning",
  },
];

/// Effort labels the Official App shows next to the model ("轻度" in the
/// reference screenshot). The protocol's `ReasoningEffort` is an open string
/// (it has a `Custom(String)` variant), so unknown values fall back to the raw
/// value rather than being dropped.
const EFFORT_LABELS: Record<string, string> = {
  none: "无推理",
  minimal: "极简",
  low: "轻度",
  medium: "中度",
  high: "高强度",
  xhigh: "超高",
  max: "最大",
  ultra: "Ultra",
};

function effortLabel(effort: ReasoningEffort | null): string {
  if (!effort) return "";
  return EFFORT_LABELS[effort] ?? effort;
}

// ADR-0016 layer 1: a persistent mode selector, separate from the per-item
// approval cards in ChatStream.
export function Composer({ threadId }: { threadId: string }) {
  const { state, sendMessage, setApprovalMode, setModelSelection, interruptActiveTurn } =
    useStore();
  const [text, setText] = useState("");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);

  const mode = state.approvalMode;
  const activeMode = APPROVAL_MODES.find((m) => m.value === mode);
  const thread = state.threads[threadId];
  // `TurnStatus` has no "waiting on approval" state (ADR-0016's stated
  // consequence), so derive it: an unresolved approval request for this thread
  // *is* the blocked state. Since approvals render inline rather than as a
  // blocking overlay, the composer has to say so itself.
  const pendingApprovals = thread?.pendingApprovals ?? [];
  const awaitingDecision = pendingApprovals.length > 0;

  const activeTurnId = thread?.activeTurnId ?? null;
  const turnRunning = activeTurnId !== null && thread?.turnStatus[activeTurnId] === "inProgress";

  const selection = state.modelSelection;
  const activeModel = state.models.find((model) => model.model === selection.model);
  // Before `model/list` resolves there is nothing truthful to name.
  const modelLabel = activeModel?.displayName ?? selection.model ?? "默认模型";

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await sendMessage(threadId, trimmed);
      setText("");
    } finally {
      setSending(false);
    }
  }

  async function handleInterrupt() {
    if (interrupting) return;
    setInterrupting(true);
    setModeError(null);
    try {
      // The store re-reads the live turn id, so a turn that ended between
      // paint and click is a no-op rather than a stale interrupt.
      await interruptActiveTurn(threadId);
    } catch (err) {
      setModeError(String(err));
    } finally {
      setInterrupting(false);
    }
  }

  async function handleModelChange(next: ModelSelection) {
    setModelMenuOpen(false);
    setModeError(null);
    try {
      await setModelSelection(next);
    } catch (err) {
      setModeError(String(err));
    }
  }

  async function handleModeChange(next: ApprovalMode) {
    setModeMenuOpen(false);
    setModeError(null);
    try {
      await setApprovalMode(next);
    } catch (err) {
      setModeError(String(err));
    }
  }

  return (
    <div className="shrink-0 pb-5">
      <div className="mx-auto w-full max-w-3xl px-6">
        {awaitingDecision && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[13px]">
            <CircleAlert className="size-4 shrink-0 text-primary" />
            {pendingApprovals.length === 1
              ? "Codex 正在等待你的批准 — 见上方卡片"
              : `Codex 正在等待你的 ${pendingApprovals.length} 项批准 — 见上方卡片`}
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card shadow-sm focus-within:border-ring/50">
          <textarea
            rows={2}
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-6 placeholder:text-muted-foreground focus:outline-none"
            placeholder="随心输入..."
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
          />

          <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
            <Button variant="ghost" size="icon-sm" aria-label="添加附件" className="text-muted-foreground">
              <Plus />
            </Button>

            <Popover open={modeMenuOpen} onOpenChange={setModeMenuOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="xs" className="gap-1.5 text-muted-foreground">
                  {activeMode && <activeMode.Icon className="size-3.5" />}
                  {activeMode?.label}
                  <ChevronDown className="size-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80">
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  应如何批准 Codex 操作？
                </div>
                {APPROVAL_MODES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-accent"
                    onClick={() => void handleModeChange(option.value)}
                  >
                    <option.Icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        option.tone === "warning" ? "text-amber-500" : "text-muted-foreground",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-[13px] font-medium",
                          option.tone === "warning" && "text-amber-600 dark:text-amber-500",
                        )}
                      >
                        {option.label}
                      </span>
                      <span className="block text-xs leading-5 text-muted-foreground">
                        {option.hint}
                      </span>
                    </span>
                    {option.value === mode && (
                      <Check className="mt-0.5 size-4 shrink-0 text-foreground" />
                    )}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            <div className="flex-1" />

            {state.models.length > 0 && (
              <Popover open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="xs" className="gap-1.5 text-muted-foreground">
                    {modelLabel}
                    {selection.effort && (
                      <span className="text-muted-foreground/70">{effortLabel(selection.effort)}</span>
                    )}
                    <ChevronDown className="size-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="max-h-96 w-80 overflow-y-auto">
                  {state.models.map((model) => {
                    const active = model.model === selection.model;
                    return (
                      <div key={model.id} className="mb-1 last:mb-0">
                        <button
                          type="button"
                          className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-accent"
                          onClick={() =>
                            void handleModelChange({
                              model: model.model,
                              // Switching model resets effort to that model's
                              // default: efforts are per-model
                              // (`supportedReasoningEfforts`), so carrying one
                              // across could name an unsupported value.
                              effort: model.defaultReasoningEffort,
                            })
                          }
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium">
                              {model.displayName}
                            </span>
                            <span className="block text-xs leading-5 text-muted-foreground">
                              {model.description}
                            </span>
                          </span>
                          {active && <Check className="mt-0.5 size-4 shrink-0 text-foreground" />}
                        </button>
                        {active && model.supportedReasoningEfforts.length > 0 && (
                          <div className="flex flex-wrap gap-1 px-2 pb-1.5 pl-3">
                            {model.supportedReasoningEfforts.map((option) => (
                              <Button
                                key={option.reasoningEffort}
                                variant={
                                  option.reasoningEffort === selection.effort ? "secondary" : "ghost"
                                }
                                size="xs"
                                title={option.description}
                                onClick={() =>
                                  void handleModelChange({
                                    model: model.model,
                                    effort: option.reasoningEffort,
                                  })
                                }
                              >
                                {effortLabel(option.reasoningEffort)}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </PopoverContent>
              </Popover>
            )}

            {turnRunning ? (
              <Button
                size="icon-sm"
                variant="secondary"
                className="rounded-full"
                aria-label="停止"
                title="停止当前回合"
                onClick={handleInterrupt}
                disabled={interrupting}
              >
                {interrupting ? <Loader2 className="animate-spin" /> : <Square className="size-3" />}
              </Button>
            ) : (
              <Button
                size="icon-sm"
                className="rounded-full"
                aria-label="发送"
                onClick={handleSend}
                disabled={sending || !text.trim()}
              >
                {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
              </Button>
            )}
          </div>
        </div>

        {modeError && (
          <div className="mt-2 text-xs text-destructive">无法切换批准模式: {modeError}</div>
        )}
      </div>
    </div>
  );
}
