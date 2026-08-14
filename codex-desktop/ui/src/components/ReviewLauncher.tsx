import { useState } from "react";
import { FileSearch, Loader2 } from "lucide-react";

import { useStore } from "../store";
import type { ReviewDelivery, ReviewTargetInput } from "../types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/// `review/start` — the CLI's `codex review`.
///
/// `ReviewTarget` is a four-variant tagged union, so this is a small form
/// rather than one button: the engine can review the working tree, a diff
/// against a base branch, a single commit, or free-form instructions.
type TargetKind = ReviewTargetInput["kind"];

const TARGETS: Array<{ kind: TargetKind; label: string; hint: string }> = [
  { kind: "uncommittedChanges", label: "未提交的改动", hint: "暂存、未暂存和未跟踪的文件" },
  { kind: "baseBranch", label: "与基线分支对比", hint: "当前分支相对某个分支的改动" },
  { kind: "commit", label: "某个提交", hint: "单个提交引入的改动" },
  { kind: "custom", label: "自定义要求", hint: "自由描述要审查什么" },
];

/// `ReviewDelivery`. The Official App surfaces this in its Git settings as
/// "代码审查发送方式"; the protocol default is inline.
const DELIVERIES: Array<{ value: ReviewDelivery; label: string; hint: string }> = [
  { value: "inline", label: "在此聊天中进行", hint: "审查结果出现在当前对话里" },
  { value: "detached", label: "独立对话", hint: "另开一个审查对话，完成后自动切换过去" },
];

export function ReviewLauncher({ threadId }: { threadId: string }) {
  const { startReview } = useStore();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TargetKind>("uncommittedChanges");
  const [branch, setBranch] = useState("");
  const [sha, setSha] = useState("");
  const [instructions, setInstructions] = useState("");
  const [delivery, setDelivery] = useState<ReviewDelivery>("inline");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /// Returns null when the chosen variant still needs input, which is what
  /// disables the submit button — rather than sending an empty branch/sha the
  /// engine would reject.
  function buildTarget(): ReviewTargetInput | null {
    switch (kind) {
      case "uncommittedChanges":
        return { kind: "uncommittedChanges" };
      case "baseBranch":
        return branch.trim() ? { kind: "baseBranch", branch: branch.trim() } : null;
      case "commit":
        return sha.trim() ? { kind: "commit", sha: sha.trim(), title: null } : null;
      case "custom":
        return instructions.trim() ? { kind: "custom", instructions: instructions.trim() } : null;
    }
  }

  const target = buildTarget();

  async function handleStart() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await startReview(threadId, target, delivery);
      setOpen(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" title="代码审查">
          <FileSearch />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-3">
        <div className="mb-2 text-[13px] font-medium">代码审查</div>

        <div className="mb-3 flex flex-col gap-0.5">
          {TARGETS.map((option) => (
            <button
              key={option.kind}
              type="button"
              onClick={() => setKind(option.kind)}
              className={cn(
                "rounded-lg px-2 py-1.5 text-left",
                kind === option.kind ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <span className="block text-[13px]">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.hint}</span>
            </button>
          ))}
        </div>

        {kind === "baseBranch" && (
          <input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="main"
            className="mb-3 h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        {kind === "commit" && (
          <input
            value={sha}
            onChange={(event) => setSha(event.target.value)}
            placeholder="提交 SHA"
            className="mb-3 h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        {kind === "custom" && (
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={3}
            placeholder="例如：只看错误处理和边界条件"
            className="mb-3 w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}

        <div className="mb-1 text-xs text-muted-foreground">发送方式</div>
        <div className="mb-3 flex flex-col gap-0.5">
          {DELIVERIES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setDelivery(option.value)}
              className={cn(
                "rounded-lg px-2 py-1.5 text-left",
                delivery === option.value ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <span className="block text-[13px]">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.hint}</span>
            </button>
          ))}
        </div>

        <Button size="sm" className="w-full" disabled={!target || busy} onClick={handleStart}>
          {busy && <Loader2 className="animate-spin" />}
          开始审查
        </Button>
        {error && <p className="mt-2 text-xs text-destructive">无法开始审查：{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
