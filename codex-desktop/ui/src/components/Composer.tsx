import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  Folder,
  Hand,
  Lightbulb,
  ListPlus,
  Loader2,
  Paperclip,
  Plus,
  Target,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";

import { useStore } from "../store";
import * as api from "../api";
import type {
  ApprovalMode,
  ComposerAttachment,
  ComposerFileRef,
  ComposerSkill,
  FileSearchHit,
  ModelSelection,
  ReasoningEffort,
  SkillMetadata,
} from "../types";
import { skillSummary } from "../types";
import { ContextMeter } from "./ContextMeter";
import { BackgroundTerminals } from "./BackgroundTerminals";
import { GoalPanel } from "./GoalPanel";
import { QueuePanel } from "./QueuePanel";
import { ReviewLauncher } from "./ReviewLauncher";
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


/// Finds a sigil-prefixed token being typed at the caret, for a typeahead.
///
/// Both sigils are the engine's own, not conventions invented here: `$` is
/// `TOOL_MENTION_SIGIL` and `@` is `PLUGIN_TEXT_MENTION_SIGIL`
/// (`utils/plugins/src/mention_syntax.rs`), and the TUI composer completes
/// files on `@` (`chat_composer.rs::insert_selected_path`).
function activeMentionQuery(
  text: string,
  caret: number,
  sigil: "$" | "@",
): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const start = upto.lastIndexOf(sigil);
  if (start === -1) return null;
  // Must start a word: `a$b` is not a mention.
  if (start > 0 && /[\w$@]/.test(upto[start - 1])) return null;
  const query = upto.slice(start + 1);
  // A mention is a single token; whitespace ends it.
  if (/\s/.test(query)) return null;
  return { start, query };
}

/// One 添加-section row in the `@` menu: icon, name, one-line description —
/// the shape the Official App uses for these entries.
function MentionRow({
  Icon,
  title,
  hint,
}: {
  Icon: typeof Target;
  title: string;
  hint: string;
}) {
  return (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
    </>
  );
}

// ADR-0016 layer 1: a persistent mode selector, separate from the per-item
// approval cards in ChatStream.
export function Composer({ threadId }: { threadId: string }) {
  const {
    state,
    sendMessage,
    queueMessage,
    setApprovalMode,
    setModelSelection,
    setCollaborationMode,
    interruptActiveTurn,
  } = useStore();
  const [goalEditorOpen, setGoalEditorOpen] = useState(false);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  /// Skills the user picked from the typeahead this message. The `$name` token
  /// also stays in `text` — the engine wants both (see `src/composer.rs`).
  const [pickedSkills, setPickedSkills] = useState<ComposerSkill[]>([]);
  const [skillQuery, setSkillQuery] = useState<{ start: number; query: string } | null>(null);
  const [skillHighlight, setSkillHighlight] = useState(0);
  /// Files and folders added from the `@` menu's 文件和文件夹 entry. Shown as
  /// chips beside the image attachments; Rust folds their paths into the text
  /// on send, because a file reference has no structured `UserInput` variant.
  const [fileRefs, setFileRefs] = useState<ComposerFileRef[]>([]);
  /// `@` file completions. Unlike skills there is no companion structured
  /// item — a picked file becomes plain path text, which is the engine's own
  /// model (see `file_mentions_are_text_only` in `src/composer.rs`).
  const [fileQuery, setFileQuery] = useState<{ start: number; query: string } | null>(null);
  const [fileMatches, setFileMatches] = useState<FileSearchHit[]>([]);
  const [fileHighlight, setFileHighlight] = useState(0);
  /// One stable token for this composer's whole lifetime: `fuzzyFileSearch`
  /// cancels the previous request that used the same value, so reusing it is
  /// what makes a fast typist's earlier search yield to the later one.
  const fileSearchToken = useRef(`codex-desktop-file-search-${Math.random().toString(36).slice(2)}`);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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

  /// Skills actually still referenced in the text. Deleting a `$name` after
  /// picking it should drop the structured item too, or the engine would load
  /// a skill the message no longer mentions.
  const activeSkills = useMemo(
    () => pickedSkills.filter((skill) => text.includes(`$${skill.name}`)),
    [pickedSkills, text],
  );

  const skillMatches = useMemo(() => {
    if (!skillQuery) return [];
    const needle = skillQuery.query.toLowerCase();
    return state.skills
      .filter((skill) => skill.name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [skillQuery, state.skills]);

  /// Roots to search: the open Projects, matching how skills are scanned
  /// per-cwd. `fuzzyFileSearch` takes `roots` explicitly and searches nothing
  /// when given none.
  const searchRoots = useMemo(
    () => state.projects.map((project) => project.path),
    [state.projects],
  );

  /// Debounced `fuzzyFileSearch`. `ignore` guards against a late response
  /// landing after the query moved on; the shared cancellation token means the
  /// server is already dropping the superseded search rather than computing it.
  useEffect(() => {
    if (!fileQuery || searchRoots.length === 0) {
      setFileMatches([]);
      return;
    }
    let ignore = false;
    const timer = setTimeout(() => {
      api
        .searchFiles(fileQuery.query, searchRoots, fileSearchToken.current)
        .then((hits) => {
          if (ignore) return;
          setFileMatches(hits.slice(0, 8));
          setFileHighlight(0);
        })
        .catch((error) => {
          if (ignore) return;
          // A failed completion should not eat the keystroke — just show nothing.
          setFileMatches([]);
          console.warn("fuzzyFileSearch failed", error);
        });
    }, 120);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [fileQuery, searchRoots]);

  function syncMentionQueries(value: string, caret: number) {
    setSkillQuery(activeMentionQuery(value, caret, "$"));
    setSkillHighlight(0);
    setFileQuery(activeMentionQuery(value, caret, "@"));
  }

  /// Replaces the `@que` token with the bare path, dropping the `@`.
  ///
  /// This mirrors the TUI's `insert_selected_path`, which likewise inserts the
  /// path alone and records no structured item — files ride in the message
  /// text, unlike skills.
  /// Entries in the `@` menu.
  ///
  /// The Official App's `@` opens a unified insertion menu, not a file picker:
  /// an 添加 section (files and folders, 目标, 计划模式) sits above the file
  /// results. Only the 目标 entry is implemented here — 计划模式 and the
  /// 插件 / ChatGPT 对话 sections are separate capabilities, and one of them
  /// (cross-conversation references) has no basis in this engine at all.
  ///
  /// Goal and file results share one flat list so arrow keys move through the
  /// menu as a whole rather than through two lists that each think they own
  /// the caret.
  type MentionEntry =
    | { kind: "pickFiles" }
    | { kind: "pickFolders" }
    | { kind: "goal" }
    | { kind: "plan" }
    | { kind: "file"; hit: FileSearchHit };

  /// Whether 计划模式 can be offered at all.
  ///
  /// Gated on the engine actually reporting a `plan` preset from
  /// `collaborationMode/list` rather than on a hardcoded name: the RPC is
  /// experimental, and offering a mode this build cannot set would be exactly
  /// the faked control ADR-0021 forbids.
  const planPreset = useMemo(
    () => state.collaborationModes.find((preset) => preset.mode === "plan" && preset.visible),
    [state.collaborationModes],
  );
  const planActive = state.collaborationMode === "plan";

  const mentionEntries: MentionEntry[] = useMemo(() => {
    if (!fileQuery) return [];
    const query = fileQuery.query.toLowerCase();
    const entries: MentionEntry[] = [];
    // 添加-section entries are commands, not search results, so they match on
    // their own names rather than being filtered out by a path search.
    const matches = (needles: string) => query === "" || needles.includes(query);
    if (matches("文件和文件夹filesfolder")) entries.push({ kind: "pickFiles" });
    if (matches("文件夹folder")) entries.push({ kind: "pickFolders" });
    if (matches("目标goal")) entries.push({ kind: "goal" });
    // The TUI refuses to switch collaboration mode mid-turn, so neither do we.
    if (planPreset && !turnRunning && matches("计划模式plan")) entries.push({ kind: "plan" });
    for (const hit of fileMatches) {
      entries.push({ kind: "file", hit });
    }
    return entries;
  }, [fileQuery, fileMatches, planPreset, turnRunning]);

  /// Removes the `@token` the menu was triggered from, without inserting
  /// anything — used when the chosen entry opens a panel instead of producing
  /// text.
  function consumeMentionToken() {
    if (!fileQuery) return;
    const caret = textareaRef.current?.selectionStart ?? text.length;
    setText(`${text.slice(0, fileQuery.start)}${text.slice(caret)}`);
    setFileQuery(null);
    setFileMatches([]);
  }

  function chooseMentionEntry(entry: MentionEntry) {
    switch (entry.kind) {
      case "goal":
        consumeMentionToken();
        setGoalEditorOpen(true);
        return;
      case "plan":
        consumeMentionToken();
        void handlePlanToggle();
        return;
      case "pickFiles":
        consumeMentionToken();
        void handlePickPaths("files");
        return;
      case "pickFolders":
        consumeMentionToken();
        void handlePickPaths("folders");
        return;
      case "file":
        chooseFile(entry.hit);
    }
  }

  /// 文件和文件夹. Two dialogs rather than one: the dialog plugin's
  /// `directory` option is a boolean switch between file mode and folder mode,
  /// with no combined mode.
  ///
  /// Picked paths become chips, not text — the Official App's presentation.
  /// Absolute paths are shortened against the Project they came from, matching
  /// what the `@` typeahead inserts (`fuzzyFileSearch` returns paths relative
  /// to their root).
  async function handlePickPaths(what: "files" | "folders") {
    const picked = what === "files" ? await api.pickAnyFiles() : await api.pickAnyFolders();
    if (!picked) return;
    const paths = (Array.isArray(picked) ? picked : [picked]).map(relativeToProject);
    setFileRefs((current) => [
      ...current,
      ...paths
        .filter((path) => !current.some((entry) => entry.path === path))
        .map((path) => ({ path })),
    ]);
    queueMicrotask(() => textareaRef.current?.focus());
  }

  function relativeToProject(path: string): string {
    for (const root of searchRoots) {
      const prefix = root.endsWith("/") || root.endsWith("\\") ? root : `${root}/`;
      if (path.startsWith(prefix)) return path.slice(prefix.length);
    }
    return path;
  }

  /// 计划模式 is a collaboration mode, not a flag: selecting it applies the
  /// engine's `plan` preset, and selecting it again returns to `default`.
  async function handlePlanToggle() {
    setModeError(null);
    try {
      await setCollaborationMode(planActive ? "default" : "plan");
    } catch (err) {
      setModeError(String(err));
    }
  }

  function chooseFile(hit: FileSearchHit) {
    if (!fileQuery) return;
    const caret = textareaRef.current?.selectionStart ?? text.length;
    // The TUI quotes paths containing whitespace so the prompt's arg parser
    // keeps them as one token; same rule here.
    const inserted =
      /\s/.test(hit.path) && !hit.path.includes('"') ? `"${hit.path}"` : hit.path;
    setText(`${text.slice(0, fileQuery.start)}${inserted} ${text.slice(caret)}`);
    setFileQuery(null);
    setFileMatches([]);
    queueMicrotask(() => textareaRef.current?.focus());
  }

  /// Replaces the partially-typed `$que` with the full `$name` and records the
  /// structured skill.
  function chooseSkill(skill: SkillMetadata) {
    if (!skillQuery) return;
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, skillQuery.start)}$${skill.name} ${text.slice(caret)}`;
    setText(next);
    setPickedSkills((current) =>
      current.some((entry) => entry.path === skill.path)
        ? current
        : [...current, { name: skill.name, path: skill.path }],
    );
    setSkillQuery(null);
    queueMicrotask(() => textareaRef.current?.focus());
  }

  async function handleAttach() {
    const picked = await api.pickImageFiles();
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    setAttachments((current) => [
      ...current,
      ...paths
        .filter((path) => !current.some((entry) => entry.kind === "localImage" && entry.path === path))
        .map((path) => ({ kind: "localImage" as const, path })),
    ]);
  }

  /// Sends, or queues when a turn is already running.
  ///
  /// Queuing is not a client-side buffer: `thread/queue/add` hands the
  /// submission to the engine, which dispatches it itself when the turn ends
  /// (`QueuedItemService::on_thread_idle`). Nothing here starts queued work —
  /// doing so on turn completion would race the engine's own dispatch and
  /// could run a submission twice.
  async function handleSend() {
    const trimmed = text.trim();
    // An image or a referenced file with no caption is a real message, so
    // either alone is enough to send.
    if ((!trimmed && attachments.length === 0 && fileRefs.length === 0) || sending) return;
    setSending(true);
    try {
      if (turnRunning) {
        await queueMessage(threadId, trimmed, attachments, activeSkills, fileRefs);
      } else {
        await sendMessage(threadId, trimmed, attachments, activeSkills, fileRefs);
      }
      setText("");
      setAttachments([]);
      setFileRefs([]);
      setPickedSkills([]);
      setSkillQuery(null);
      setFileQuery(null);
      setFileMatches([]);
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

        <GoalPanel
          threadId={threadId}
          editorOpen={goalEditorOpen}
          onEditorOpenChange={setGoalEditorOpen}
        />
        <QueuePanel threadId={threadId} />

        <div className="relative rounded-2xl border border-border bg-card shadow-sm focus-within:border-ring/50">
          {skillQuery && skillMatches.length > 0 && (
            <div className="absolute bottom-full left-3 z-20 mb-2 w-96 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg">
              <div className="px-2 py-1 text-[11px] text-muted-foreground">技能</div>
              {skillMatches.map((skill, index) => (
                <button
                  key={skill.path}
                  type="button"
                  onMouseDown={(event) => {
                    // mousedown, not click: the textarea must not lose focus
                    // before we can restore the caret.
                    event.preventDefault();
                    chooseSkill(skill);
                  }}
                  onMouseEnter={() => setSkillHighlight(index)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left",
                    index === skillHighlight ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <span className="text-[13px] font-medium">${skill.name}</span>
                  {skillSummary(skill) && (
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {skillSummary(skill)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Rendered whenever `@` is active, even with nothing to offer: the
              empty state below is the only thing that explains why. */}
          {fileQuery && (
            <div className="absolute bottom-full left-3 z-20 mb-2 w-96 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg">
              {mentionEntries.map((entry, index) => {
                const highlighted = index === fileHighlight;
                // Section headers are rendered inline with their first entry
                // so the flat keyboard list and the visual grouping stay in
                // sync automatically.
                const header =
                  index === 0
                    ? "添加"
                    : entry.kind === "file" && mentionEntries[index - 1]?.kind !== "file"
                      ? "文件"
                      : null;
                return (
                  <div
                    key={
                      entry.kind === "file"
                        ? `${entry.hit.root}/${entry.hit.path}`
                        : entry.kind
                    }
                  >
                    {header && (
                      <div className="px-2 py-1 text-[11px] text-muted-foreground">{header}</div>
                    )}
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        // mousedown, not click: the textarea must not lose
                        // focus before we can restore the caret.
                        event.preventDefault();
                        chooseMentionEntry(entry);
                      }}
                      onMouseEnter={() => setFileHighlight(index)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
                        highlighted ? "bg-accent" : "hover:bg-accent/60",
                      )}
                    >
                      {entry.kind === "pickFiles" ? (
                        <MentionRow
                          Icon={Paperclip}
                          title="文件和文件夹"
                          hint="从磁盘选择文件"
                        />
                      ) : entry.kind === "pickFolders" ? (
                        <MentionRow Icon={Folder} title="文件夹" hint="从磁盘选择文件夹" />
                      ) : entry.kind === "goal" ? (
                        <MentionRow Icon={Target} title="目标" hint="设置要持续追求的目标" />
                      ) : entry.kind === "plan" ? (
                        <MentionRow
                          Icon={Lightbulb}
                          title="计划模式"
                          hint={planActive ? "关闭计划模式" : "开启计划模式"}
                        />
                      ) : (
                        <>
                          {entry.hit.isDirectory ? (
                            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">
                              {entry.hit.fileName}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {entry.hit.path}
                            </span>
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}

              {/* The 文件 header is rendered inline with the first file entry,
                  so with no matches the section vanishes entirely and the menu
                  looks like it only ever offers 目标. Say what's going on
                  instead — the Official App shows the same "输入内容搜索文件"
                  prompt in this state. */}
              {fileMatches.length === 0 && (
                <div>
                  <div className="px-2 py-1 text-[11px] text-muted-foreground">文件</div>
                  <div className="px-2 pb-1.5 text-xs text-muted-foreground">
                    {searchRoots.length === 0
                      ? "先在侧边栏打开一个项目才能搜索文件"
                      : fileQuery.query === ""
                        ? "输入内容搜索文件"
                        : `没有匹配“${fileQuery.query}”的文件`}
                  </div>
                </div>
              )}
            </div>
          )}

          {fileRefs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {fileRefs.map((ref, index) => (
                <span
                  key={`fileRef-${ref.path}`}
                  className="flex max-w-[240px] items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs"
                >
                  <FileText className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate">{ref.path.split(/[/\\]/).pop()}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {ref.path}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label="移除文件"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setFileRefs((current) => current.filter((_, i) => i !== index))}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {attachments.map((attachment, index) => (
                <span
                  key={`${attachment.kind}-${index}`}
                  className="flex max-w-[240px] items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs"
                >
                  <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    {attachment.kind === "localImage"
                      ? attachment.path.split(/[/\\]/).pop()
                      : attachment.url}
                  </span>
                  <button
                    type="button"
                    aria-label="移除附件"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setAttachments((current) => current.filter((_, i) => i !== index))
                    }
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={2}
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-6 placeholder:text-muted-foreground focus:outline-none"
            placeholder="随心输入，输入 $ 引用技能，@ 引用文件..."
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              syncMentionQueries(event.target.value, event.target.selectionStart ?? 0);
            }}
            onClick={(event) =>
              syncMentionQueries(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)
            }
            onBlur={() => {
              setSkillQuery(null);
              setFileQuery(null);
            }}
            onKeyDown={(event) => {
              // While a typeahead is open it owns the arrow/enter keys. Only
              // one can be open at a time: the two sigils can't both start the
              // token at the caret.
              if (fileQuery && mentionEntries.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setFileHighlight((index) => (index + 1) % mentionEntries.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setFileHighlight(
                    (index) => (index - 1 + mentionEntries.length) % mentionEntries.length,
                  );
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  chooseMentionEntry(mentionEntries[fileHighlight]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setFileQuery(null);
                  return;
                }
              }
              if (skillQuery && skillMatches.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSkillHighlight((index) => (index + 1) % skillMatches.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSkillHighlight(
                    (index) => (index - 1 + skillMatches.length) % skillMatches.length,
                  );
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  chooseSkill(skillMatches[skillHighlight]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSkillQuery(null);
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
          />

          <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="添加图片"
              title="添加图片"
              className="text-muted-foreground"
              onClick={handleAttach}
            >
              <Plus />
            </Button>

            {/* Plan mode is toggled from the `@` menu, so without a visible
                indicator there would be no way to tell it is on — or to find
                the way back out. Clicking returns to the default mode. */}
            {planActive && (
              <Button
                variant="ghost"
                size="xs"
                className="gap-1.5 text-primary"
                title="计划模式已开启，点击返回默认模式"
                disabled={turnRunning}
                onClick={() => void handlePlanToggle()}
              >
                <Lightbulb className="size-3.5" />
                计划模式
              </Button>
            )}

            <ReviewLauncher threadId={threadId} />

            <BackgroundTerminals threadId={threadId} />

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

            <ContextMeter threadId={threadId} />

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

            {/* While a turn runs both actions stay reachable: stopping and
                queuing the next instruction are independent intents, and
                collapsing them into one button would make whichever lost
                unreachable exactly when it is wanted. */}
            {turnRunning && (
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
            )}
            <Button
              size="icon-sm"
              className="rounded-full"
              aria-label={turnRunning ? "加入队列" : "发送"}
              title={turnRunning ? "加入队列，当前回合结束后自动执行" : undefined}
              onClick={handleSend}
              disabled={
                sending || (!text.trim() && attachments.length === 0 && fileRefs.length === 0)
              }
            >
              {sending ? (
                <Loader2 className="animate-spin" />
              ) : turnRunning ? (
                <ListPlus />
              ) : (
                <ArrowUp />
              )}
            </Button>
          </div>
        </div>

        {modeError && (
          <div className="mt-2 text-xs text-destructive">无法切换批准模式: {modeError}</div>
        )}
      </div>
    </div>
  );
}
