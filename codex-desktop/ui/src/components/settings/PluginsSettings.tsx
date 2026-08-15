import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";

import { useStore } from "../../store";
import { useAsyncAction } from "./useAsyncAction";
import * as api from "../../api";
import type { PluginMarketplaceEntry, PluginSummary } from "../../types";
import { SettingRow, SettingsHeader, SettingsSection } from "./SettingsPrimitives";
import { Button } from "@/components/ui/button";

// Plugins and marketplaces.
//
// Basis per control (ADR-0021's admission test):
//   installed list      -> `plugin/installed`
//   catalog / browse    -> `plugin/list`
//   install             -> `plugin/install`
//   uninstall           -> `plugin/uninstall`
//   add marketplace     -> `marketplace/add`
//   remove marketplace  -> `marketplace/remove`
//   upgrade marketplace -> `marketplace/upgrade`
//
// There is no `plugin/installed` *notification* — that name is a request, not
// a push signal — so install/uninstall re-list rather than waiting for one.
//
// `plugin/search` is deliberately unused: it is `#[experimental]`, and the
// catalog `plugin/list` already returns is small enough to filter in the
// browser. Filtering a list already in hand is presentation (admissible);
// wiring an experimental RPC for it would add a dependency for nothing.

export function PluginsSettings() {
  const { state } = useStore();
  const [installed, setInstalled] = useState<PluginMarketplaceEntry[] | null>(null);
  const [catalog, setCatalog] = useState<PluginMarketplaceEntry[] | null>(null);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const { busyKey, isBusy, error, setError, run } = useAsyncAction();
  const [query, setQuery] = useState("");
  const [confirmingUninstall, setConfirmingUninstall] = useState<string | null>(null);
  const [source, setSource] = useState("");

  // Open Projects are passed so repo-local marketplaces are discovered too —
  // `PluginListParams.cwds` exists precisely for this.
  const cwds = state.projects.map((project) => project.path);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [installedResponse, catalogResponse] = await Promise.all([
        api.listInstalledPlugins(cwds),
        api.listPlugins(cwds),
      ]);
      setInstalled(installedResponse.marketplaces ?? []);
      setCatalog(catalogResponse.marketplaces ?? []);
      setLoadErrors(
        [
          ...(installedResponse.marketplaceLoadErrors ?? []),
          ...(catalogResponse.marketplaceLoadErrors ?? []),
        ].map((entry) => `${entry.marketplacePath}: ${entry.message}`),
      );
    } catch (err) {
      setInstalled([]);
      setCatalog([]);
      setError(String(err));
    }
    // Keyed on `state.projects` rather than the derived `cwds` array, whose
    // identity changes every render and would re-fetch endlessly.
  }, [state.projects]);

  useEffect(() => {
    void load();
  }, [load]);


  const installedPlugins = (installed ?? []).flatMap((entry) =>
    entry.plugins.filter((plugin) => plugin.installed),
  );

  const needle = query.trim().toLowerCase();
  const catalogEntries = (catalog ?? [])
    .map((entry) => ({
      ...entry,
      plugins: entry.plugins.filter((plugin) => {
        if (plugin.installed) return false;
        if (!needle) return true;
        return (
          plugin.name.toLowerCase().includes(needle) ||
          (plugin.interface?.displayName ?? "").toLowerCase().includes(needle) ||
          (plugin.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(needle))
        );
      }),
    }))
    .filter((entry) => entry.plugins.length > 0);

  return (
    <>
      <SettingsHeader title="插件" description="来自市场的扩展，可为 Codex 增加技能与工具。" />

      <SettingsSection
        title="已安装"
        action={
          <Button variant="outline" size="xs" onClick={() => void load()} disabled={busyKey !== null}>
            <RefreshCw />
            刷新
          </Button>
        }
      >
        {installed === null ? (
          <Pending />
        ) : installedPlugins.length === 0 ? (
          <Empty>尚未安装任何插件。</Empty>
        ) : (
          installedPlugins.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              control={
                confirmingUninstall === plugin.id ? (
                  <span className="flex items-center gap-1.5">
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={busyKey !== null}
                      onClick={() =>
                        void run(() => api.uninstallPlugin(plugin.id), { key: plugin.id })
                      }
                    >
                      确认卸载
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setConfirmingUninstall(null)}
                    >
                      取消
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busyKey !== null}
                    onClick={() => setConfirmingUninstall(plugin.id)}
                  >
                    {isBusy(plugin.id) ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    卸载
                  </Button>
                )
              }
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title="可安装">
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索插件…"
              className="h-8 w-full rounded-lg border border-input bg-background pr-2 pl-8 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
        {catalog === null ? (
          <Pending />
        ) : catalogEntries.length === 0 ? (
          <Empty>{needle ? "没有匹配的插件。" : "没有可安装的插件。"}</Empty>
        ) : (
          catalogEntries.map((entry) => (
            <div key={entry.name}>
              <div className="bg-muted/40 px-4 py-1.5 text-[11px] text-muted-foreground">
                {entry.interface?.displayName ?? entry.name}
              </div>
              {entry.plugins.map((plugin) => (
                <PluginRow
                  key={`${entry.name}/${plugin.id}`}
                  plugin={plugin}
                  control={
                    <Button
                      size="xs"
                      disabled={busyKey !== null || plugin.installPolicy === "NOT_AVAILABLE"}
                      onClick={() =>
                        void run(
                          () =>
                            api.installPlugin(
                              plugin.name,
                              entry.path ?? null,
                              entry.path ? null : entry.name,
                            ),
                          { key: plugin.id },
                        )
                      }
                    >
                      {isBusy(plugin.id) ? <Loader2 className="animate-spin" /> : <Download />}
                      安装
                    </Button>
                  }
                />
              ))}
            </div>
          ))
        )}
      </SettingsSection>

      <SettingsSection
        title="市场"
        action={
          <Button
            variant="outline"
            size="xs"
            disabled={busyKey !== null}
            onClick={() => void run(() => api.upgradeMarketplace(null), { key: "__upgrade__" })}
          >
            {isBusy("__upgrade__") ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            全部升级
          </Button>
        }
      >
        {(catalog ?? []).map((entry) => (
          <SettingRow
            key={entry.name}
            label={entry.interface?.displayName ?? entry.name}
            description={entry.path ?? "远程目录"}
            control={
              entry.path ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={busyKey !== null}
                  onClick={() => void run(() => api.removeMarketplace(entry.name), { key: entry.name })}
                >
                  移除
                </Button>
              ) : null
            }
          />
        ))}
        <div className="flex items-center gap-2 px-4 py-3">
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="市场来源（Git URL 或本地路径）"
            className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            size="xs"
            variant="outline"
            disabled={busyKey !== null || source.trim().length === 0}
            onClick={() =>
              void run(async () => {
                await api.addMarketplace(source.trim());
                setSource("");
              }, { key: "__add__" })
            }
          >
            添加
          </Button>
        </div>
      </SettingsSection>

      {loadErrors.length > 0 && (
        <SettingsSection title="市场加载问题">
          {loadErrors.map((message, index) => (
            <div key={index} className="px-4 py-3 text-xs text-destructive">
              {message}
            </div>
          ))}
        </SettingsSection>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}

function PluginRow({ plugin, control }: { plugin: PluginSummary; control: React.ReactNode }) {
  const version = plugin.localVersion ?? plugin.version;
  return (
    <SettingRow
      label={plugin.interface?.displayName ?? plugin.name}
      description={
        <span className="flex flex-col gap-1">
          {plugin.interface?.description && <span>{plugin.interface.description}</span>}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[11px]">{plugin.name}</span>
            {version && (
              <>
                <span>·</span>
                <span>v{version}</span>
              </>
            )}
            {!plugin.enabled && plugin.installed && (
              <>
                <span>·</span>
                <span>已停用</span>
              </>
            )}
          </span>
          {/* Reported verbatim from plugin-service. This app has no upgrade or
              purchase path, so an unavailable plugin is stated, not sold. */}
          {plugin.disabledReason && <span>{plugin.disabledReason}</span>}
        </span>
      }
      control={control}
    />
  );
}

function Pending() {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      正在读取…
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</div>;
}
