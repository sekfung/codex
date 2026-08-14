import { useEffect, useState } from "react";
import { Loader2, Pencil, Target, X } from "lucide-react";

import { useStore } from "../store";
import type { ThreadGoalStatus, TokenBudgetEdit } from "../types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/// `thread/goal/*`.
///
/// A goal persists across turns — the Official App describes it as
/// "设置要持续追求的目标" — so it reads as standing context above the composer
/// rather than as a field inside one message.

const STATUS_LABELS: Record<ThreadGoalStatus, string> = {
  active: "进行中",
  paused: "已暂停",
  blocked: "受阻",
  usageLimited: "用量受限",
  budgetLimited: "预算耗尽",
  complete: "已完成",
};

/// Only these three are a user's to choose. `usageLimited`/`budgetLimited` are
/// set by the engine when a goal exhausts its allowance, and offering them
/// would imply this client can put a goal into a state it cannot.
const SELECTABLE_STATUSES: ThreadGoalStatus[] = ["active", "paused", "complete"];

function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(1)}k`;
}

export function GoalPanel({
  threadId,
  editorOpen,
  onEditorOpenChange,
}: {
  threadId: string;
  editorOpen: boolean;
  onEditorOpenChange: (open: boolean) => void;
}) {
  const { state, refetchGoal, setGoal, clearGoal } = useStore();
  const goal = state.threads[threadId]?.goal ?? null;
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `thread/goal/get` is the only way to learn a goal set before this window
  // opened — there is no notification replaying existing state on attach.
  useEffect(() => {
    refetchGoal(threadId).catch(() => {
      /* absence is reported by the panel itself; a failed read is not fatal */
    });
  }, [threadId, refetchGoal]);

  useEffect(() => {
    if (!editorOpen) return;
    setObjective(goal?.objective ?? "");
    setBudget(goal?.tokenBudget != null ? String(goal.tokenBudget) : "");
    setError(null);
  }, [editorOpen, goal]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    const trimmed = objective.trim();
    if (!trimmed) return;
    const raw = budget.trim();
    // Three-way, not nullable: the protocol distinguishes "leave alone" from
    // "clear", so an emptied field means clear rather than "unspecified".
    const tokenBudget: TokenBudgetEdit =
      raw === "" ? { kind: "clear" } : { kind: "set", tokens: Number(raw) };
    if (raw !== "" && (!Number.isFinite(Number(raw)) || Number(raw) <= 0)) {
      setError("预算需为正整数");
      return;
    }
    await run(async () => {
      await setGoal(threadId, trimmed, null, tokenBudget);
      onEditorOpenChange(false);
    });
  }

  if (editorOpen) {
    return (
      <div className="mb-2 rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
          <Target className="size-4 text-muted-foreground" />
          {goal ? "编辑目标" : "设置目标"}
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="关闭"
            onClick={() => onEditorOpenChange(false)}
          >
            <X />
          </Button>
        </div>
        <textarea
          autoFocus
          rows={2}
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          placeholder="要持续追求的目标…"
          className="w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="mt-2 flex items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="goal-budget">
            令牌预算
          </label>
          <input
            id="goal-budget"
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
            placeholder="不限"
            inputMode="numeric"
            className="h-7 w-28 rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="flex-1" />
          <Button size="sm" onClick={handleSave} disabled={busy || !objective.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            保存
          </Button>
        </div>
        {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
      </div>
    );
  }

  if (!goal) return null;

  const overBudget =
    goal.tokenBudget != null && goal.tokenBudget > 0 && goal.tokensUsed >= goal.tokenBudget;

  return (
    <div className="mb-2 flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
      <Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-5">{goal.objective}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{STATUS_LABELS[goal.status] ?? goal.status}</span>
          <span>·</span>
          <span className={cn(overBudget && "text-amber-600 dark:text-amber-500")}>
            {formatTokens(goal.tokensUsed)}
            {goal.tokenBudget != null ? ` / ${formatTokens(goal.tokenBudget)}` : ""} 令牌
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Select
          value={goal.status}
          onValueChange={(next) =>
            void run(() => setGoal(threadId, null, next as ThreadGoalStatus, null))
          }
          options={SELECTABLE_STATUSES.map((status) => ({
            value: status,
            label: STATUS_LABELS[status],
          }))}
          className="h-7"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="编辑目标"
          title="编辑目标"
          onClick={() => onEditorOpenChange(true)}
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="清除目标"
          title="清除目标"
          disabled={busy}
          onClick={() => void run(() => clearGoal(threadId))}
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
