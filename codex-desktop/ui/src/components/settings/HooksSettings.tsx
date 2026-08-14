import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import * as api from "../../api";
import type { HookMetadata, HooksListEntry } from "../../types";
import { SettingRow, SettingsHeader, SettingsSection } from "./SettingsPrimitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Hooks (`hooks/list`).
//
// Read-only, and not by choice: the protocol has no hooks *write* RPC at all —
// no create, no update, no enable/disable. Under ADR-0021's admission test a
// hook editor here would have no basis, so the screen shows what is configured
// and points at `config.toml` for changes.

const EVENT_LABELS: Record<string, string> = {
  preToolUse: "工具调用前",
  permissionRequest: "权限请求时",
  postToolUse: "工具调用后",
  preCompact: "压缩前",
  postCompact: "压缩后",
  sessionStart: "会话开始",
  sessionEnd: "会话结束",
  userPromptSubmit: "提交提示时",
  subagentStart: "子智能体开始",
  subagentStop: "子智能体结束",
  stop: "停止时",
};

const TRUST_LABELS: Record<string, string> = {
  managed: "受管控",
  untrusted: "未信任",
  trusted: "已信任",
  modified: "已修改",
};

export function HooksSettings() {
  const [entries, setEntries] = useState<HooksListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string | null>(null);

  useEffect(() => {
    api
      .listHooks()
      .then((response) => setEntries(response.data ?? []))
      .catch((err) => {
        setEntries([]);
        setError(String(err));
      });
    api.configFilePath().then(setConfigPath).catch(() => setConfigPath(null));
  }, []);

  const hooks = (entries ?? []).flatMap((entry) => entry.hooks);
  const warnings = (entries ?? []).flatMap((entry) => entry.warnings);
  const loadErrors = (entries ?? []).flatMap((entry) => entry.errors);

  return (
    <>
      <SettingsHeader
        title="钩子"
        description="在特定事件发生时运行的命令。钩子只能在 config.toml 中编辑 — 协议尚未提供写入接口。"
      />

      <SettingsSection
        title="已配置的钩子"
        action={
          configPath && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => void api.openPathInOs(configPath)}
            >
              打开 config.toml
              <ExternalLink />
            </Button>
          )
        }
      >
        {entries === null ? (
          <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在读取…
          </div>
        ) : hooks.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            尚未配置任何钩子。
          </div>
        ) : (
          hooks
            .slice()
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((hook) => <HookRow key={hook.key} hook={hook} />)
        )}
      </SettingsSection>

      {(warnings.length > 0 || loadErrors.length > 0) && (
        <SettingsSection title="加载问题">
          {warnings.map((warning, index) => (
            <div key={`w-${index}`} className="px-4 py-3 text-xs text-muted-foreground">
              {warning}
            </div>
          ))}
          {loadErrors.map((entry, index) => (
            <div key={`e-${index}`} className="px-4 py-3 text-xs">
              <div className="font-mono text-muted-foreground">{entry.path}</div>
              <div className="text-destructive">{entry.message}</div>
            </div>
          ))}
        </SettingsSection>
      )}

      {error && <p className="text-xs text-destructive">读取钩子失败：{error}</p>}
    </>
  );
}

function HookRow({ hook }: { hook: HookMetadata }) {
  return (
    <SettingRow
      label={EVENT_LABELS[hook.eventName] ?? hook.eventName}
      description={
        <span className="flex flex-col gap-1">
          {hook.command && (
            <code className="block overflow-x-auto font-mono text-[11px]">{hook.command}</code>
          )}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{hook.handlerType}</span>
            <span>·</span>
            <span>{hook.executionMode === "async" ? "异步" : "同步"}</span>
            {hook.matcher && (
              <>
                <span>·</span>
                <span>匹配 {hook.matcher}</span>
              </>
            )}
            <span>·</span>
            <span>来源 {hook.source}</span>
          </span>
          {hook.statusMessage && <span className="text-destructive">{hook.statusMessage}</span>}
        </span>
      }
      control={
        <span className="flex items-center gap-1.5">
          {!hook.enabled && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              已停用
            </span>
          )}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px]",
              hook.trustStatus === "untrusted" || hook.trustStatus === "modified"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground",
            )}
          >
            {TRUST_LABELS[hook.trustStatus] ?? hook.trustStatus}
          </span>
        </span>
      }
    />
  );
}
