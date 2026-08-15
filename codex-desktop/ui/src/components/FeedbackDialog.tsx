import { useState } from "react";
import { Check, Loader2, MessageSquareWarning } from "lucide-react";

import * as api from "../api";
import { useStore } from "../store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * `feedback/upload`.
 *
 * Lives beside the review launcher in the composer toolbar because feedback
 * is thread-scoped — `FeedbackUploadParams.thread_id` is the conversation
 * being reported on, so an entry point that loses the current thread would
 * have to send `null` and lose the only context that makes a report useful.
 *
 * The classifications are the engine's own string values, from
 * `tui/src/bottom_pane/feedback_view.rs::feedback_classification` — not a
 * vocabulary invented here.
 */
const CLASSIFICATIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "bad_result", label: "结果不好", hint: "Codex 做错了，或做得不够好" },
  { value: "good_result", label: "结果很好", hint: "这次表现值得记录" },
  { value: "bug", label: "程序缺陷", hint: "崩溃、报错、界面异常" },
  { value: "safety_check", label: "拒绝执行", hint: "被拒绝，但本应被允许" },
  { value: "other", label: "其他", hint: "速度、功能建议、使用体验等" },
];

export function FeedbackDialog({ threadId }: { threadId: string }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const [classification, setClassification] = useState("bad_result");
  const [reason, setReason] = useState("");
  const [includeLogs, setIncludeLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `feedback.enabled` in config.toml, default true — the same gate the TUI
  // applies before opening its own feedback view (`config.feedback_enabled`,
  // derived in `core/src/config/mod.rs` with `unwrap_or(true)`). A deployment
  // that turns it off should not be offered the control at all.
  const feedbackConfig = state.config?.feedback as { enabled?: boolean } | undefined;
  if (feedbackConfig?.enabled === false) return null;

  async function handleSend() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.uploadFeedback(classification, reason.trim() || null, threadId, includeLogs);
      setSent(true);
      setReason("");
      setIncludeLogs(false);
      setTimeout(() => {
        setSent(false);
        setOpen(false);
      }, 1200);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="反馈"
          title="反馈"
          className="text-muted-foreground"
        >
          <MessageSquareWarning />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">发送反馈</div>

        <div className="flex flex-col gap-0.5">
          {CLASSIFICATIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn(
                "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent",
                option.value === classification && "bg-accent",
              )}
              onClick={() => setClassification(option.value)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{option.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{option.hint}</span>
              </span>
              {option.value === classification && <Check className="mt-0.5 size-4 shrink-0" />}
            </button>
          ))}
        </div>

        <textarea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="补充说明（可选）"
          className="mt-2 w-full resize-none rounded-lg border border-input bg-background px-2 py-1.5 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {/* This is user data leaving the machine, so it says what goes with it
            rather than just offering a switch. The list matches what the TUI
            names on its own consent screen (`feedback_view.rs`). */}
        <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-accent">
          <input
            type="checkbox"
            checked={includeLogs}
            onChange={(event) => setIncludeLogs(event.target.checked)}
            className="mt-0.5"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">同时上传日志</span>
            <span className="block text-xs leading-5 text-muted-foreground">
              将附带 Codex 运行日志与诊断报告（codex-logs.log、doctor 报告，以及可用时的
              apps/连接器缓存）。不勾选则只发送上面的分类和说明。
            </span>
          </span>
        </label>

        <div className="mt-1 px-2 pb-1 text-xs text-muted-foreground">
          反馈会关联当前对话，便于团队复现。
        </div>

        {error && <div className="px-2 pb-1 text-xs text-destructive">发送失败：{error}</div>}

        <div className="mt-1 flex justify-end gap-1.5 px-1 pb-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button size="sm" onClick={handleSend} disabled={busy || sent}>
            {busy ? <Loader2 className="animate-spin" /> : sent ? <Check /> : null}
            {sent ? "已发送" : "发送"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
