import { useEffect, useState } from "react";
import { FileDiff, KeyRound, MessageCircleQuestion, Terminal } from "lucide-react";

import { useStore } from "../store";
import * as api from "../api";
import type {
  ExecPolicyAmendment,
  FileSystemSandboxEntry,
  NetworkPolicyAmendment,
  PendingApproval,
  PendingCommandExecutionApproval,
  PendingFileChangeApproval,
  PendingPermissionsApproval,
  PendingElicitationRequest,
  PendingUserInputRequest,
  ElicitationAnswer,
  ElicitationView,
  PermissionProfile,
  UserInputAnswerDraft,
} from "../types";
import { Button } from "@/components/ui/button";

// Inline stream card, not a modal (ADR-0016 layer 2). Exposes every decision
// variant the protocol supports (ADR-0015) rather than a simplified
// accept/decline set.
export function ApprovalCard({ approval }: { approval: PendingApproval }) {
  const { dispatch } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(run: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      dispatch({
        type: "APPROVAL_RESOLVED",
        threadId: approval.threadId,
        requestId: approval.requestId,
      });
    } catch (err) {
      // Leave the card up: an approval that silently failed to send would
      // strand the turn with no way to retry.
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const shared = { busy, error, resolve };

  if (approval.kind === "commandExecution") {
    return <CommandExecutionApproval approval={approval} {...shared} />;
  }
  if (approval.kind === "fileChange") {
    return <FileChangeApproval approval={approval} {...shared} />;
  }
  if (approval.kind === "userInput") {
    return <UserInputRequestCard request={approval} {...shared} />;
  }
  if (approval.kind === "elicitation") {
    return <ElicitationCard request={approval} {...shared} />;
  }
  return <PermissionsApproval approval={approval} {...shared} />;
}

/// `mcpServer/elicitation/request`: an MCP server asking the user to fill in a
/// form, confirm, or visit a URL.
///
/// The schema arrives as a deeply nested untagged union; `elicitation_view`
/// flattens it in Rust so this component only ever sees a list of controls.
/// Answers go back the same way — Rust types each one from its declared
/// control, because a number field must send `3` and not `"3"`.
function ElicitationCard({
  request,
  busy,
  error,
  resolve,
}: DecisionProps & { request: PendingElicitationRequest }) {
  const [view, setView] = useState<ElicitationView | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [multi, setMulti] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let ignore = false;
    api
      .elicitationView(request.params)
      .then((next) => {
        if (ignore) return;
        setView(next);
        // Seed defaults so the form starts where the server suggested.
        const seedValues: Record<string, string> = {};
        const seedChecks: Record<string, boolean> = {};
        const seedMulti: Record<string, string[]> = {};
        for (const field of next.fields) {
          const control = field.control;
          if (control.kind === "boolean") seedChecks[field.key] = control.default ?? false;
          else if (control.kind === "multiSelect") seedMulti[field.key] = control.default ?? [];
          else if (control.kind === "number")
            seedValues[field.key] = control.default == null ? "" : String(control.default);
          else seedValues[field.key] = control.default ?? "";
        }
        setValues(seedValues);
        setChecks(seedChecks);
        setMulti(seedMulti);
      })
      .catch((err) => {
        if (ignore) return;
        // Still answerable: decline/cancel don't need the form.
        setViewError(String(err));
      });
    return () => {
      ignore = true;
    };
  }, [request.params]);

  const fields = view?.fields ?? [];
  const answers: ElicitationAnswer[] = fields.map((field) => ({
    key: field.key,
    value: values[field.key] ?? null,
    checked: checks[field.key] ?? null,
    values: multi[field.key] ?? null,
  }));

  const canAccept =
    view !== null &&
    !view.unrenderableReason &&
    fields.every((field) => {
      if (!field.required) return true;
      const control = field.control;
      if (control.kind === "boolean") return true;
      if (control.kind === "multiSelect") return (multi[field.key] ?? []).length > 0;
      return (values[field.key] ?? "").trim() !== "";
    });

  function toggleMulti(key: string, value: string) {
    setMulti((current) => {
      const chosen = current[key] ?? [];
      return {
        ...current,
        [key]: chosen.includes(value)
          ? chosen.filter((entry) => entry !== value)
          : [...chosen, value],
      };
    });
  }

  return (
    <CardShell
      Icon={MessageCircleQuestion}
      title={<>MCP 服务器请求输入{request.serverName ? `：${request.serverName}` : ""}</>}
    >
      {view && <div className="text-[13px]">{view.message}</div>}
      {viewError && <Detail>无法解析该请求的表单：{viewError}</Detail>}
      {view?.unrenderableReason && <Detail>{view.unrenderableReason}</Detail>}

      {view?.mode === "url" && view.url && (
        <Detail>
          请先访问{" "}
          <button
            type="button"
            className="text-primary underline underline-offset-2"
            onClick={() => void api.openPathInOs(view.url as string)}
          >
            {view.url}
          </button>
          ，完成后再确认。
        </Detail>
      )}

      {fields.length > 0 && (
        <div className="mt-2 flex flex-col gap-3">
          {fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <div>
                <div className="text-[13px] font-medium">
                  {field.label}
                  {field.required && <span className="ml-1 text-destructive">*</span>}
                </div>
                {field.description && (
                  <div className="text-xs text-muted-foreground">{field.description}</div>
                )}
              </div>

              {field.control.kind === "boolean" ? (
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={checks[field.key] ?? false}
                    onChange={(event) =>
                      setChecks((current) => ({ ...current, [field.key]: event.target.checked }))
                    }
                  />
                  是
                </label>
              ) : field.control.kind === "select" ? (
                <div className="flex flex-wrap gap-1.5">
                  {field.control.options.map((option) => {
                    const active = values[field.key] === option.value;
                    return (
                      <Button
                        key={option.value}
                        size="sm"
                        variant={active ? "default" : "outline"}
                        disabled={busy}
                        onClick={() =>
                          setValues((current) => ({
                            ...current,
                            [field.key]: active ? "" : option.value,
                          }))
                        }
                      >
                        {option.label}
                      </Button>
                    );
                  })}
                </div>
              ) : field.control.kind === "multiSelect" ? (
                <div className="flex flex-wrap gap-1.5">
                  {field.control.options.map((option) => {
                    const active = (multi[field.key] ?? []).includes(option.value);
                    return (
                      <Button
                        key={option.value}
                        size="sm"
                        variant={active ? "default" : "outline"}
                        disabled={busy}
                        onClick={() => toggleMulti(field.key, option.value)}
                      >
                        {option.label}
                      </Button>
                    );
                  })}
                </div>
              ) : (
                <input
                  type={field.control.kind === "number" ? "number" : "text"}
                  step={
                    field.control.kind === "number" && field.control.integer ? 1 : undefined
                  }
                  value={values[field.key] ?? ""}
                  disabled={busy}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              )}
            </div>
          ))}
        </div>
      )}

      <Actions>
        <Button
          size="sm"
          disabled={busy || !canAccept}
          onClick={() =>
            resolve(() =>
              api.resolveElicitation(request.requestId, "accept", fields, answers),
            )
          }
        >
          确认
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          title="拒绝本次请求，但不中断当前回合"
          onClick={() =>
            resolve(() => api.resolveElicitation(request.requestId, "decline", [], []))
          }
        >
          拒绝
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          title="取消本次请求"
          onClick={() =>
            resolve(() => api.resolveElicitation(request.requestId, "cancel", [], []))
          }
        >
          取消
        </Button>
      </Actions>
      <CardError error={error} />
    </CardShell>
  );
}

interface DecisionProps {
  busy: boolean;
  error: string | null;
  resolve: (run: () => Promise<void>) => Promise<void>;
}

/// Distinguished from ordinary messages by a subtle accent-tinted frame —
/// noticeable without being alarming, since most approvals are routine.
function CardShell({
  Icon,
  title,
  children,
}: {
  Icon: typeof Terminal;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-3.5">
      <div className="mb-2.5 flex items-center gap-2 text-[13px] font-medium">
        <Icon className="size-4 shrink-0 text-primary" />
        {title}
      </div>
      {children}
    </div>
  );
}

function CardError({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="mt-2 text-xs text-destructive">决策发送失败: {error}</div>;
}

function Detail({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 text-xs text-muted-foreground">{children}</div>;
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-1.5">{children}</div>;
}

function CommandExecutionApproval({
  approval,
  busy,
  error,
  resolve,
}: DecisionProps & { approval: PendingCommandExecutionApproval }) {
  // `availableDecisions` is the server telling us which decisions are
  // meaningful for this prompt; when absent, offer the full set (ADR-0015).
  const available = approval.availableDecisions?.map((decision) => decision.type);
  const offers = (decision: string) => !available || available.includes(decision);

  const execAmendment = approval.proposedExecpolicyAmendment ?? null;
  const networkAmendments = approval.proposedNetworkPolicyAmendments ?? [];

  return (
    <CardShell
      Icon={Terminal}
      title={<>批准运行命令{approval.reason ? `：${approval.reason}` : ""}</>}
    >
      {approval.command && (
        <code className="block overflow-x-auto rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
          {approval.command}
        </code>
      )}
      {approval.cwd && (
        <Detail>
          工作目录 <span className="font-mono">{approval.cwd}</span>
        </Detail>
      )}
      <Actions>
        {offers("accept") && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              resolve(() =>
                api.resolveCommandExecutionApproval(approval.requestId, { type: "accept" }),
              )
            }
          >
            允许
          </Button>
        )}
        {offers("acceptForSession") && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              resolve(() =>
                api.resolveCommandExecutionApproval(approval.requestId, {
                  type: "acceptForSession",
                }),
              )
            }
          >
            本次会话都允许
          </Button>
        )}
        {/* Only offered when the server actually proposed an amendment — the
            decision echoes that proposal back verbatim rather than inventing
            a policy change client-side. */}
        {execAmendment && offers("acceptWithExecpolicyAmendment") && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            title={`始终允许：${formatExecAmendment(execAmendment)}`}
            onClick={() =>
              resolve(() =>
                api.resolveCommandExecutionApproval(approval.requestId, {
                  type: "acceptWithExecpolicyAmendment",
                  execpolicyAmendment: execAmendment,
                }),
              )
            }
          >
            允许并始终放行 {formatExecAmendment(execAmendment)}
          </Button>
        )}
        {networkAmendments.map((amendment, index) => (
          <Button
            key={`${amendment.host}-${amendment.action}-${index}`}
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              resolve(() =>
                api.resolveCommandExecutionApproval(approval.requestId, {
                  type: "applyNetworkPolicyAmendment",
                  networkPolicyAmendment: amendment,
                }),
              )
            }
          >
            {formatNetworkAmendment(amendment)}
          </Button>
        ))}
        {offers("decline") && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              resolve(() =>
                api.resolveCommandExecutionApproval(approval.requestId, { type: "decline" }),
              )
            }
          >
            拒绝
          </Button>
        )}
        {offers("cancel") && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            className="text-destructive hover:text-destructive"
            title="拒绝该命令并中断整轮任务"
            onClick={() =>
              resolve(() =>
                api.resolveCommandExecutionApproval(approval.requestId, { type: "cancel" }),
              )
            }
          >
            中断本轮
          </Button>
        )}
      </Actions>
      <CardError error={error} />
    </CardShell>
  );
}

function FileChangeApproval({
  approval,
  busy,
  error,
  resolve,
}: DecisionProps & { approval: PendingFileChangeApproval }) {
  return (
    <CardShell
      Icon={FileDiff}
      title={<>批准文件改动{approval.reason ? `：${approval.reason}` : ""}</>}
    >
      {approval.grantRoot && (
        <Detail>
          将授予本次会话对 <code className="font-mono">{approval.grantRoot}</code> 下的写入权限。
        </Detail>
      )}
      <Actions>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            resolve(() => api.resolveFileChangeApproval(approval.requestId, { type: "accept" }))
          }
        >
          允许
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            resolve(() =>
              api.resolveFileChangeApproval(approval.requestId, { type: "acceptForSession" }),
            )
          }
        >
          本次会话都允许
        </Button>
        {/* Decline vs Cancel are kept distinct per ADR-0015: Decline
            continues the turn, Cancel also interrupts it. */}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            resolve(() => api.resolveFileChangeApproval(approval.requestId, { type: "decline" }))
          }
        >
          拒绝
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          className="text-destructive hover:text-destructive"
          title="拒绝该改动并中断整轮任务"
          onClick={() =>
            resolve(() => api.resolveFileChangeApproval(approval.requestId, { type: "cancel" }))
          }
        >
          中断本轮
        </Button>
      </Actions>
      <CardError error={error} />
    </CardShell>
  );
}

function PermissionsApproval({
  approval,
  busy,
  error,
  resolve,
}: DecisionProps & { approval: PendingPermissionsApproval }) {
  const requested = approval.permissions ?? {};

  // Granting echoes the requested profile back: `RequestPermissionProfile` and
  // `GrantedPermissionProfile` are the same `{network?, fileSystem?}` shape,
  // so "grant what was asked" is a faithful round-trip. What changes per
  // button is the *scope* (this turn vs. the session).
  function grant(scope: "turn" | "session") {
    return api.resolvePermissionsApproval(approval.requestId, {
      permissions: requested,
      scope,
    });
  }

  return (
    <CardShell
      Icon={KeyRound}
      title={<>请求额外权限{approval.reason ? `：${approval.reason}` : ""}</>}
    >
      {approval.cwd && (
        <Detail>
          针对 <span className="font-mono">{approval.cwd}</span>
        </Detail>
      )}
      <PermissionProfileSummary profile={requested} />
      <Actions>
        <Button size="sm" disabled={busy} onClick={() => resolve(() => grant("turn"))}>
          仅本轮授予
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => resolve(() => grant("session"))}
        >
          本次会话授予
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => resolve(() => api.rejectApproval(approval.requestId, "Denied by user"))}
        >
          拒绝
        </Button>
      </Actions>
      <CardError error={error} />
    </CardShell>
  );
}

/// Renders what a permission profile actually asks for, so "Grant" is an
/// informed decision rather than a blind one.
function PermissionProfileSummary({ profile }: { profile: PermissionProfile }) {
  const lines: string[] = [];

  if (profile.network?.enabled) lines.push("网络访问");

  const fs = profile.fileSystem;
  if (fs) {
    for (const path of fs.read ?? []) lines.push(`读取：${path}`);
    for (const path of fs.write ?? []) lines.push(`写入：${path}`);
    for (const entry of fs.entries ?? []) lines.push(formatSandboxEntry(entry));
  }

  if (lines.length === 0) {
    // Better to say so than to render an empty box that looks like "nothing
    // is being requested."
    return (
      <Detail>
        该权限配置为空，或使用了当前版本尚不能解析的结构 — 授予前请自行确认。
      </Detail>
    );
  }

  return (
    <ul className="mt-2 flex flex-col gap-1">
      {lines.map((line, index) => (
        <li key={index} className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
          <span className="font-mono">{line}</span>
        </li>
      ))}
    </ul>
  );
}

function formatSandboxEntry(entry: FileSystemSandboxEntry): string {
  const access = entry.access.charAt(0).toUpperCase() + entry.access.slice(1);
  const path = entry.path;
  if (path.kind === "path") return `${access}: ${path.path}`;
  if (path.kind === "glob_pattern") return `${access}: ${path.pattern}`;
  return `${access}: ${JSON.stringify(path.value)}`;
}

function formatExecAmendment(amendment: ExecPolicyAmendment): string {
  return amendment.command.join(" ");
}

function formatNetworkAmendment(amendment: NetworkPolicyAmendment): string {
  return amendment.action === "allow"
    ? `始终允许访问 ${amendment.host}`
    : `始终禁止访问 ${amendment.host}`;
}

/// `item/tool/requestUserInput` — a tool asking the user a question.
///
/// Rendered inline like the approval cards because it is the same class of
/// thing: the turn waits on this client. Answers are collected per question
/// and encoded in Rust (`src/user_input.rs`), which owns the two conventions
/// that are easy to get silently wrong — a chosen option answers with its
/// label, and free text carries a `user_note:` prefix.
function UserInputRequestCard({
  request,
  busy,
  error,
  resolve,
}: DecisionProps & { request: PendingUserInputRequest }) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const drafts: UserInputAnswerDraft[] = request.questions.map((question) => ({
    questionId: question.id,
    selectedLabel: selected[question.id] ?? null,
    note: notes[question.id] ?? null,
  }));

  // The protocol has no "decline" verb — an unanswered question is submitted
  // as an empty answer list, which is what the TUI does too. So skipping is
  // just submitting with nothing filled in, and it still unblocks the turn.
  const anyAnswer = drafts.some((draft) => draft.selectedLabel || draft.note?.trim());

  return (
    <CardShell Icon={MessageCircleQuestion} title="Codex 需要你的补充信息">
      {!request.isBlocking && (
        <Detail>这是非阻塞询问，不回答也不会卡住当前回合。</Detail>
      )}
      <div className="flex flex-col gap-3">
        {request.questions.map((question) => {
          const options = question.options ?? [];
          const hasOptions = options.length > 0;
          return (
            <div key={question.id} className="flex flex-col gap-1.5">
              <div>
                <div className="text-[13px] font-medium">{question.header}</div>
                <div className="text-xs text-muted-foreground">{question.question}</div>
              </div>

              {hasOptions && (
                <div className="flex flex-wrap gap-1.5">
                  {options.map((option) => {
                    const active = selected[question.id] === option.label;
                    return (
                      <Button
                        key={option.label}
                        size="sm"
                        variant={active ? "default" : "outline"}
                        disabled={busy}
                        title={option.description}
                        onClick={() =>
                          setSelected((current) => ({
                            ...current,
                            // Clicking the active option clears it, so a
                            // mis-click isn't a decision you can't undo.
                            [question.id]: active ? "" : option.label,
                          }))
                        }
                      >
                        {option.label}
                      </Button>
                    );
                  })}
                </div>
              )}

              {/* Free text when there are no options, and alongside them when
                  the question is marked `isOther`. */}
              {(!hasOptions || question.isOther) && (
                <input
                  type={question.isSecret ? "password" : "text"}
                  value={notes[question.id] ?? ""}
                  disabled={busy}
                  placeholder={hasOptions ? "其他（补充说明）" : "输入回答"}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                />
              )}
            </div>
          );
        })}
      </div>

      <Actions>
        <Button
          size="sm"
          disabled={busy || !anyAnswer}
          onClick={() => resolve(() => api.resolveUserInputRequest(request.requestId, drafts))}
        >
          提交
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          title="不回答并让当前回合继续"
          onClick={() =>
            resolve(() =>
              api.resolveUserInputRequest(
                request.requestId,
                request.questions.map((question) => ({ questionId: question.id })),
              ),
            )
          }
        >
          跳过
        </Button>
      </Actions>
      <CardError error={error} />
    </CardShell>
  );
}
