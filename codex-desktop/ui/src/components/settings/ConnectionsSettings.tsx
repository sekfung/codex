import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react";

import { useStore } from "../../store";
import * as api from "../../api";
import type { McpAuthStatus, McpServerRuntimeState, McpServerStatus } from "../../types";
import { SettingRow, SettingsHeader, SettingsSection } from "./SettingsPrimitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// MCP servers (`mcpServerStatus/list`). A failing MCP server is otherwise
// invisible in this app, which is the main reason this screen exists.
//
// Read-only on purpose. Adding or editing a server is expressible in principle
// — servers live under `mcp_servers` in `config.toml`, reachable via
// `config/value/write` — but `McpServerConfig` requires an `environment_id`
// plus a transport union this build has no way to let a user choose
// meaningfully. Rather than ship a form that can only produce invalid servers,
// the screen sends people to `config.toml` (ADR-0021: don't invent capability).

const AUTH_LABELS: Record<McpAuthStatus, string> = {
  unknown: "未知",
  unsupported: "无需认证",
  notLoggedIn: "未登录",
  bearerToken: "已配置令牌",
  oauth: "已通过 OAuth 登录",
};

export function ConnectionsSettings() {
  const { state } = useStore();
  const [servers, setServers] = useState<McpServerStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await api.listMcpServers();
      setServers(response.data ?? []);
    } catch (err) {
      setServers([]);
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function reload() {
    setBusy("__reload__");
    try {
      await api.reloadMcpServers();
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function login(name: string) {
    setBusy(name);
    setError(null);
    try {
      const { authorizationUrl } = await api.mcpServerLogin(name);
      // The RPC only hands back a URL; the browser does the rest, and the
      // result arrives as `mcpServer/oauthLogin/completed`.
      await api.openPathInOs(authorizationUrl);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <SettingsHeader
        title="连接"
        description="Codex 可以使用的 MCP 服务器。服务器本身在 config.toml 中配置。"
      />

      <SettingsSection
        title="MCP 服务器"
        action={
          <Button variant="outline" size="xs" onClick={reload} disabled={busy !== null}>
            {busy === "__reload__" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            重新加载
          </Button>
        }
      >
        {servers === null ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">正在读取…</div>
        ) : servers.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            尚未配置任何 MCP 服务器。
          </div>
        ) : (
          servers.map((server) => (
            <ServerRow
              key={server.name}
              server={server}
              runtime={state.mcpRuntime[server.name]}
              busy={busy === server.name}
              onLogin={() => void login(server.name)}
            />
          ))
        )}
      </SettingsSection>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}

function ServerRow({
  server,
  runtime,
  busy,
  onLogin,
}: {
  server: McpServerStatus;
  runtime: McpServerRuntimeState | undefined;
  busy: boolean;
  onLogin: () => void;
}) {
  const toolCount = Object.keys(server.tools ?? {}).length;
  const needsLogin = server.authStatus === "notLoggedIn";

  return (
    <SettingRow
      label={server.name}
      description={
        <span className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StartupBadge runtime={runtime} />
            <span>{AUTH_LABELS[server.authStatus] ?? server.authStatus}</span>
            <span>·</span>
            <span>{toolCount} 个工具</span>
            {server.pluginId && (
              <>
                <span>·</span>
                <span>来自插件 {server.pluginId}</span>
              </>
            )}
          </span>
          {runtime?.error && <span className="text-destructive">{runtime.error}</span>}
        </span>
      }
      control={
        needsLogin ? (
          <Button size="xs" onClick={onLogin} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <ExternalLink />}
            登录
          </Button>
        ) : null
      }
    />
  );
}

/// Startup state comes only from `mcpServer/startupStatus/updated`, so before
/// any notification arrives there is genuinely nothing to report — better to
/// show nothing than to imply a healthy server.
function StartupBadge({ runtime }: { runtime: McpServerRuntimeState | undefined }) {
  if (!runtime) return null;
  const { status } = runtime;
  const failed = status === "failed" || status === "cancelled";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]",
        failed ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
      )}
    >
      {failed ? (
        <AlertTriangle className="size-3" />
      ) : status === "ready" ? (
        <CheckCircle2 className="size-3" />
      ) : (
        <Loader2 className="size-3 animate-spin" />
      )}
      {status === "ready"
        ? "运行中"
        : status === "starting"
          ? "启动中"
          : status === "failed"
            ? "启动失败"
            : "已取消"}
    </span>
  );
}
