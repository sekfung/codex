import { useCallback, useEffect, useState } from "react";
import { Check, Download, Loader2, RefreshCw, TriangleAlert } from "lucide-react";

import * as api from "../../api";
import { useStore } from "../../store";
import type { DetectedMigrationSource, ImportProgress } from "../../types";
import { SettingsHeader, SettingsSection } from "./SettingsPrimitives";
import { Button } from "@/components/ui/button";

// External agent config import (`externalAgentConfig/detect` + `/import`).
//
// The engine probes two sources, `claude-code` and `cursor`
// (`tui/src/external_agent_config_migration/source.rs::ALL`).
//
// Import is additive on the engine side, which is why this screen offers a
// plain "import" rather than a scary confirmation: `merge_missing_toml_values`
// only inserts keys the target lacks, `import_agents_md` writes only when the
// target AGENTS.md is missing or empty, and hooks are copied with
// `copy_dir_recursive_skip_existing`. Nothing it does replaces an existing
// value, so re-running it is safe and simply finds less to do.

/**
 * `ExternalAgentConfigMigrationItemType` values, which are SCREAMING_CASE on
 * the wire. Rendering falls back to the raw value so an item type this build
 * does not know about is still shown rather than silently dropped.
 */
const ITEM_TYPE_LABELS: Record<string, string> = {
  AGENTS_MD: "AGENTS.md 指令",
  CONFIG: "配置",
  SKILLS: "技能",
  PLUGINS: "插件",
  MCP_SERVER_CONFIG: "MCP 服务器配置",
  SUBAGENTS: "子智能体",
  HOOKS: "钩子",
  COMMANDS: "命令",
  MEMORY: "记忆",
  SESSIONS: "历史会话",
};

export function ImportSettings() {
  const { state } = useStore();
  const [sources, setSources] = useState<DetectedMigrationSource[] | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<Record<string, string>>({});
  const [importError, setImportError] = useState<Record<string, string>>({});

  // Serialized rather than passed as an array so the callback below has a
  // stable dependency; `state.projects` is a fresh array on every render.
  const projectPathsKey = JSON.stringify(state.projects.map((project) => project.path));

  const detect = useCallback(() => {
    setSources(null);
    setDetectError(null);
    api
      .detectExternalAgentConfig(JSON.parse(projectPathsKey) as string[])
      .then(setSources)
      .catch((err) => {
        setSources([]);
        setDetectError(String(err));
      });
  }, [projectPathsKey]);

  useEffect(detect, [detect]);

  async function handleImport(source: DetectedMigrationSource) {
    setImporting(source.source);
    setImportError((current) => ({ ...current, [source.source]: "" }));
    try {
      // The server's own detected objects go back unchanged, with the same
      // `migrationSource` — the protocol requires both to match.
      const importId = await api.importExternalAgentConfig(
        source.source,
        source.items.map((item) => item.raw),
      );
      // The response is only an id — the outcome arrives on
      // `externalAgentConfig/import/completed`, so record the id and let the
      // store fill in what actually happened.
      setImported((current) => ({ ...current, [source.source]: importId }));
    } catch (err) {
      setImportError((current) => ({ ...current, [source.source]: String(err) }));
    } finally {
      setImporting(null);
    }
  }

  const withItems = (sources ?? []).filter((source) => source.items.length > 0);

  return (
    <>
      <SettingsHeader
        title="导入"
        description="从其他智能体工具导入配置。导入只会补全缺失的内容，不会覆盖你已有的设置。"
      />

      <SettingsSection title="可导入的来源">
        {sources === null ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在检测…
          </div>
        ) : detectError ? (
          <div className="px-4 py-6 text-sm text-destructive">检测失败：{detectError}</div>
        ) : withItems.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            没有检测到可导入的配置。
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {withItems.map((source) => {
              const importId = imported[source.source];
              // Absent until the first progress notification: the request
              // returning means "accepted", not "finished".
              const progress = importId ? state.imports[importId] : undefined;
              const started = Boolean(importId);
              const done = progress?.done ?? false;
              return (
              <div key={source.source} className="rounded-xl border border-border p-3.5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-[13px] font-medium">{source.label}</span>
                  <Button
                    size="sm"
                    disabled={importing !== null || started}
                    onClick={() => handleImport(source)}
                  >
                    {importing === source.source || (started && !done) ? (
                      <Loader2 className="animate-spin" />
                    ) : done ? (
                      <Check />
                    ) : (
                      <Download />
                    )}
                    {done ? "已导入" : started ? "导入中…" : "导入"}
                  </Button>
                </div>

                {progress && <ImportResults progress={progress} />}

                <ul className="flex flex-col gap-1">
                  {source.items.map((item, index) => (
                    <li key={index} className="flex items-start gap-2 text-xs">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">
                          {ITEM_TYPE_LABELS[item.itemType] ?? item.itemType}
                        </span>
                        <span className="text-muted-foreground"> · {item.description}</span>
                        {item.cwd && (
                          <span className="block truncate font-mono text-muted-foreground">
                            {item.cwd}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                {importError[source.source] && (
                  <div className="mt-2 text-xs text-destructive">
                    导入失败：{importError[source.source]}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}

        {/* A source that failed detection is reported rather than silently
            omitted — otherwise "nothing to import" and "we could not look"
            are indistinguishable. */}
        {(sources ?? [])
          .filter((source) => source.error)
          .map((source) => (
            <div key={source.source} className="mt-2 text-xs text-muted-foreground">
              无法检测 {source.label}：{source.error}
            </div>
          ))}

        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={detect} disabled={sources === null}>
            <RefreshCw />
            重新检测
          </Button>
        </div>
      </SettingsSection>
    </>
  );
}

/**
 * Per-item outcomes from `externalAgentConfig/import/progress`/`completed`.
 *
 * Without these the screen could only say an import had started: the import
 * request's response carries nothing but an id.
 */
function ImportResults({ progress }: { progress: ImportProgress }) {
  if (progress.results.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-col gap-1">
      {progress.results.map((result, index) => {
        const failed = result.failures.length;
        const ok = result.successes.length;
        return (
          <li key={index} className="flex items-center gap-2 text-xs">
            {failed > 0 ? (
              <TriangleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
            ) : (
              <Check className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">
              <span className="font-medium">
                {ITEM_TYPE_LABELS[result.itemType] ?? result.itemType}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · 成功 {ok}
                {failed > 0 ? ` · 失败 ${failed}` : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
