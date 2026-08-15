import { useEffect, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import * as api from "../../api";
import { useStore } from "../../store";
import { useAsyncAction } from "./useAsyncAction";
import type { MemorySettings } from "../../types";
import { ConfigPending, OriginNote, SettingRow, SettingsHeader, SettingsSection } from "./SettingsPrimitives";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

// Memories.
//
// Two settings and one destructive action, mirroring the TUI's own
// `MemoriesSettingsView` — which is where the scope of this screen comes from,
// not from a reference screenshot (the Official App's nav is cut off before
// any memories entry would appear).
//
// `MemoriesToml` carries a dozen more tuning keys (consolidation limits, model
// overrides, idle windows). None has a user-facing control anywhere in this
// repo, so under ADR-0021 there is nothing to render them from — they stay in
// `config.toml`.
//
// The asymmetry in the two descriptions is real and worth preserving: the read
// path applies to the *next* thread, while the write path applies to the
// current one too. That is exactly why `thread/memoryMode/set` exists and why
// saving pushes it (see `src/memories.rs`).

export function MemoriesSettings() {
  const { state } = useStore();
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const { busy, error, setError, run } = useAsyncAction();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetNote, setResetNote] = useState<string | null>(null);

  useEffect(() => {
    api
      .readMemorySettings()
      .then(setSettings)
      .catch((err) => setError(String(err)));
  }, []);

  async function apply(next: MemorySettings) {
    const previous = settings;
    // Optimistic: the toggle should not lag a round-trip. Rolled back below if
    // the write fails, so a failure never leaves the UI claiming a setting
    // that was not stored.
    setSettings(next);
    await run(
      () =>
        api.setMemorySettings(
          next,
          state.activeThreadId,
          previous ? previous.generateMemories !== next.generateMemories : false,
        ),
      { onError: () => setSettings(previous) },
    );
  }

  async function reset() {
    setResetNote(null);
    await run(async () => {
      await api.resetMemories();
      setResetNote("已清除本机记忆。");
      setConfirmingReset(false);
    });
  }

  if (!settings) {
    return (
      <>
        <SettingsHeader title="记忆" />
        {error ? <p className="text-xs text-destructive">{error}</p> : <ConfigPending />}
      </>
    );
  }

  return (
    <>
      <SettingsHeader
        title="记忆"
        description="Codex 可以从过往对话中提炼记忆，并在新对话中使用它们。设置保存在 config.toml 中。"
      />

      <SettingsSection title="记忆">
        <SettingRow
          label="使用记忆"
          description={
            <>
              在后续对话中使用已有记忆。<OriginNote keyPath="memories.use_memories" />
              <span className="mt-0.5 block">对当前对话不生效，从下一个对话开始应用。</span>
            </>
          }
          control={
            <Switch
              checked={settings.useMemories}
              disabled={busy}
              aria-label="使用记忆"
              onCheckedChange={(next) => void apply({ ...settings, useMemories: next })}
            />
          }
        />
        <SettingRow
          label="生成记忆"
          description={
            <>
              从对话中提炼新的记忆。<OriginNote keyPath="memories.generate_memories" />
              <span className="mt-0.5 block">包含当前对话，保存后立即生效。</span>
            </>
          }
          control={
            <Switch
              checked={settings.generateMemories}
              disabled={busy}
              aria-label="生成记忆"
              onCheckedChange={(next) => void apply({ ...settings, generateMemories: next })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="重置">
        <div className="px-4 py-3.5">
          <div className="text-[13px] font-medium">清除全部记忆</div>
          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
            删除本机 Codex 主目录下的记忆文件与对话摘要。<strong>此操作不可撤销</strong>，且对
            所有项目生效。已有的对话记录不受影响。
          </div>

          {confirmingReset ? (
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1 text-xs leading-5">
                  确认清除全部记忆？这会删除记忆文件与摘要，无法恢复。
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void reset()}
                >
                  {busy && <Loader2 className="animate-spin" />}
                  确认清除
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmingReset(false)}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmingReset(true)}
            >
              清除全部记忆…
            </Button>
          )}

          {resetNote && <div className="mt-2 text-xs text-muted-foreground">{resetNote}</div>}
        </div>
      </SettingsSection>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}
