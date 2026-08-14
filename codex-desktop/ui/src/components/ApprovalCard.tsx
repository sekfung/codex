import { useState } from "react";
import { FileDiff, KeyRound, Terminal } from "lucide-react";

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
  PermissionProfile,
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
  return <PermissionsApproval approval={approval} {...shared} />;
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
