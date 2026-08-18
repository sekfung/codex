import { useEffect } from "react";
import { Loader2 } from "lucide-react";

import * as api from "../../api";
import { useStore } from "../../store";
import { useAsyncAction } from "./useAsyncAction";
import type { FeatureFlag } from "../../types";
import { SettingRow, SettingsHeader, SettingsSection } from "./SettingsPrimitives";
import { Switch } from "@/components/ui/switch";

// Experimental features (`experimentalFeature/list` + `config/batchWrite`).
//
// Scope is the engine's own: only `stage === "beta"` entries appear. That is
// the same filter the TUI's `/experimental` menu applies — it builds its list
// from `spec.stage.experimental_menu_name()`, which returns `Some` only for
// `Stage::Experimental` (`chatwidget/settings_popups.rs::open_experimental_popup`)
// — and it is why `displayName`/`description` are documented non-null only for
// beta features. Rendering any other stage would mean inventing copy the
// engine deliberately withholds.
//
// Two consequences of that filter worth recording, because they look like
// omissions otherwise:
//
//   * `guardian_approval` is `Stage::Stable`, so it never appears here. The
//     cascade in the TUI's `update_feature_flags` — enabling guardian also
//     rewrites `approvals_reviewer`, `approval_policy` and `sandbox_mode` — is
//     reached from its permissions UI, not from `/experimental`. This screen is
//     therefore cascade-free by construction, not by omission.
//   * Writes go through `config.toml`, never
//     `experimentalFeature/enablement/set`: that RPC is runtime-only and its
//     allowlist contains no beta-stage flag. See `src/features.rs`.
//
// Nav placement under 编码 is *our* choice, not copied — the reference
// screenshots' nav is cut off below 环境 and never shows an experimental entry.
// Presentation is free under ADR-0021 test 2.

export function ExperimentalSettings() {
  const { state, refetchFeatures } = useStore();
  const { isBusy, error, run } = useAsyncAction();

  // Loaded once at startup for gating; refresh on open so a change made from
  // the CLI sharing this `$CODEX_HOME` (ADR-0008) is reflected.
  useEffect(() => {
    refetchFeatures();
  }, [refetchFeatures]);

  const beta = state.features.filter((feature) => feature.stage === "beta");

  async function toggle(feature: FeatureFlag, enabled: boolean) {
    await run(
      async () => {
        await api.setFeatureEnabled(feature.name, enabled);
        // Re-read rather than patching locally: a managed or project config
        // layer can pin a flag, so the effective value is the server's to
        // report. The same reasoning as the skills screen.
        refetchFeatures();
      },
      { key: feature.name },
    );
  }

  return (
    <>
      <SettingsHeader
        title="实验性功能"
        description="正在测试中的功能，默认关闭。开关会写入 config.toml，因此对共享同一 $CODEX_HOME 的 Codex CLI 同样生效；部分功能需要重启 Codex 后才会实际启用。"
      />

      <SettingsSection title="可用的实验性功能">
        {beta.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            当前版本没有开放中的实验性功能。
          </div>
        ) : (
          beta.map((feature) => (
            <SettingRow
              key={feature.name}
              label={feature.displayName?.trim() || feature.name}
              description={
                <span className="flex flex-col gap-1">
                  <span>{feature.description?.trim() || "（无描述）"}</span>
                  <code className="block truncate font-mono text-[11px]">
                    features.{feature.name}
                  </code>
                </span>
              }
              control={
                isBusy(feature.name) ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  <Switch
                    checked={feature.enabled}
                    onCheckedChange={(next) => void toggle(feature, next)}
                    aria-label={`启用 ${feature.displayName ?? feature.name}`}
                  />
                )
              }
            />
          ))
        )}
      </SettingsSection>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}
