import { useState } from "react";
import { FileSearch, Loader2 } from "lucide-react";

import { useStore } from "../store";
import * as api from "../api";
import type { GitRefs, ReviewDelivery, ReviewTargetInput } from "../types";
import { threadCwd } from "../lib/threads";
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

/// The two targets that only mean something inside a git work tree.
const GIT_TARGETS = new Set<TargetKind>(["baseBranch", "commit"]);

/// `ReviewDelivery`. The Official App surfaces this in its Git settings as
/// "代码审查发送方式", but it is a per-request parameter, not a stored
/// preference: `turn_processor.rs` reads it as `delivery.unwrap_or(Inline)` and
/// no config key backs it. That is why it lives here, at the point of use,
/// rather than on a settings screen.
const DELIVERIES: Array<{ value: ReviewDelivery; label: string; hint: string }> = [
  { value: "inline", label: "在此聊天中进行", hint: "审查结果出现在当前对话里" },
  { value: "detached", label: "独立对话", hint: "另开一个审查对话，完成后自动切换过去" },
];

/// Candidate chips under a free-text field.
///
/// Deliberately additive: the field stays editable, so a branch that is not in
/// the list (a remote-tracking ref, a tag) can still be typed. The chips are a
/// shortcut, not a constraint — `local_git_branches` only knows local heads.
function RefChips({
  items,
  selected,
  onPick,
}: {
  items: Array<{ key: string; label: string; value: string }>;
  selected: string;
  onPick: (value: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onPick(item.value)}
          className={cn(
            "rounded-full border px-2 py-0.5 text-xs",
            selected === item.value
              ? "border-primary bg-primary/10 text-foreground"
              : "border-input text-muted-foreground hover:bg-accent/60",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function ReviewLauncher({ threadId }: { threadId: string }) {
  const { state, startReview } = useStore();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TargetKind>("uncommittedChanges");
  const [branch, setBranch] = useState("");
  const [sha, setSha] = useState("");
  const [instructions, setInstructions] = useState("");
  const [delivery, setDelivery] = useState<ReviewDelivery>("inline");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refs, setRefs] = useState<GitRefs | null>(null);

  // The thread's own repository, not the selected Project — they differ for
  // threads opened from search. See `lib/threads.ts`.
  const cwd = threadCwd(state.threadsByProject, threadId) ?? state.activeProjectPath;

  /// Candidates are fetched when the popover opens, not on mount: branches and
  /// commits change under the app, and this shells out to git, so paying for it
  /// on every chat render would be wrong. A failure is swallowed rather than
  /// surfaced — the inputs stay usable as free text, which is exactly the
  /// previous behavior, so there is nothing the user must act on.
  async function loadRefs() {
    if (!cwd) return;
    try {
      setRefs(await api.gitRefs(cwd));
    } catch {
      setRefs(null);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) void loadRefs();
  }

  // Hidden rather than disabled when the directory is not a repository: an
  // inert "与基线分支对比" row invites the user to wonder what is wrong, and
  // `isGitRepo: false` is a definite answer, not a loading state.
  const targets = refs && !refs.isGitRepo ? TARGETS.filter((t) => !GIT_TARGETS.has(t.kind)) : TARGETS;

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
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" title="代码审查">
          <FileSearch />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-3">
        <div className="mb-2 text-[13px] font-medium">代码审查</div>

        <div className="mb-3 flex flex-col gap-0.5">
          {targets.map((option) => (
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
          <div className="mb-3">
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder={refs?.branches[0] ?? "main"}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {/* The branch the user is on is never a useful comparison base
                against itself, so it is offered as context but not as a
                choice. `local_git_branches` already puts the default branch
                first, which is the one people want most of the time. */}
            <RefChips
              items={(refs?.branches ?? [])
                .filter((name) => name !== refs?.currentBranch)
                .slice(0, 6)
                .map((name) => ({ key: name, label: name, value: name }))}
              selected={branch}
              onPick={setBranch}
            />
          </div>
        )}
        {kind === "commit" && (
          <div className="mb-3">
            <input
              value={sha}
              onChange={(event) => setSha(event.target.value)}
              placeholder="提交 SHA"
              className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {/* Subjects, not SHAs, because nobody recognizes a hex string. The
                full SHA is what gets sent; the abbreviation is display only. */}
            <div className="mt-1.5 flex flex-col gap-0.5">
              {(refs?.commits ?? []).slice(0, 8).map((commit) => (
                <button
                  key={commit.sha}
                  type="button"
                  onClick={() => setSha(commit.sha)}
                  className={cn(
                    "flex items-baseline gap-2 rounded-md px-2 py-1 text-left",
                    sha === commit.sha ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {commit.sha.slice(0, 7)}
                  </span>
                  <span className="truncate text-[13px]">{commit.subject}</span>
                </button>
              ))}
            </div>
          </div>
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
