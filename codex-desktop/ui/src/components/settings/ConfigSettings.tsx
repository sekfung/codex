import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

import { useStore } from "../../store";
import * as api from "../../api";
import type {
  AskForApproval,
  ReasoningSummary,
  SandboxMode,
  Verbosity,
  WebSearchMode,
} from "../../types";
import { ConfigPending, OriginNote, SettingRow, SettingsHeader, SettingsSection } from "./SettingsPrimitives";
import { Select } from "@/components/ui/select";
import type { SelectOption } from "@/components/ui/select";

// The GUI over `config.toml` (ADR-0020), following reference screenshot 04.
//
// Every control here writes a real config key. `keyPath` values are dotted
// snake_case TOML paths, which is what `config/value/write` expects — not the
// camelCase names the JSON `Config` object uses when reading back.

const APPROVAL_POLICIES: SelectOption<string>[] = [
  { value: "untrusted", label: "仅信任命令", hint: "除已知安全的命令外都需批准" },
  { value: "on-request", label: "按请求", hint: "由 Codex 在需要时请求批准" },
  { value: "never", label: "从不询问", hint: "不请求批准" },
];

const SANDBOX_MODES: SelectOption<SandboxMode>[] = [
  { value: "read-only", label: "只读", hint: "只能读取文件" },
  { value: "workspace-write", label: "工作区可写", hint: "可修改工作区内的文件" },
  { value: "danger-full-access", label: "完全访问", hint: "不受沙盒限制" },
];

const WEB_SEARCH_MODES: SelectOption<WebSearchMode>[] = [
  { value: "disabled", label: "已禁用" },
  { value: "cached", label: "已缓存", hint: "只使用缓存结果" },
  { value: "indexed", label: "索引" },
  { value: "live", label: "实时", hint: "直接访问网络" },
];

const VERBOSITY: SelectOption<Verbosity>[] = [
  { value: "low", label: "简洁" },
  { value: "medium", label: "中等" },
  { value: "high", label: "详细" },
];

const REASONING_SUMMARY: SelectOption<ReasoningSummary>[] = [
  { value: "auto", label: "自动" },
  { value: "concise", label: "简要" },
  { value: "detailed", label: "详细" },
  { value: "none", label: "不显示" },
];

export function ConfigSettings() {
  const { state, writeSetting } = useStore();
  const config = state.config;
  const requirements = state.configRequirements;
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.configFilePath().then(setConfigPath).catch(() => setConfigPath(null));
  }, []);

  async function write(keyPath: string, value: unknown) {
    setError(null);
    try {
      await writeSetting({ keyPath, value });
    } catch (err) {
      // A managed layer can refuse the write; saying so beats a control that
      // silently springs back to its old value.
      setError(String(err));
    }
  }

  /// Deployment requirements can narrow the allowed values; when they do, the
  /// screen must not offer what the server would reject.
  function allowed<T extends string>(
    options: SelectOption<T>[],
    permitted: readonly unknown[] | null | undefined,
  ): SelectOption<T>[] {
    if (!permitted || permitted.length === 0) return options;
    const set = new Set(permitted.map((entry) => JSON.stringify(entry)));
    return options.filter((option) => set.has(JSON.stringify(option.value)));
  }

  if (!config) return <ConfigPending />;

  // `approvalPolicy` is usually a string, but the protocol also allows a
  // `Granular { … }` object. A dropdown can't represent that, so it is shown
  // as unset-with-a-note rather than silently coerced.
  const approvalPolicy: AskForApproval | null | undefined = config.approvalPolicy;
  const granularPolicy = approvalPolicy !== null && typeof approvalPolicy === "object";

  return (
    <>
      <SettingsHeader
        title="配置"
        description="配置新聊天的权限、网页访问和智能体回复。"
      />

      <SettingsSection
        title="智能体默认设置"
        action={
          configPath && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => api.openPathInOs(configPath).catch((err) => setError(String(err)))}
            >
              打开 config.toml
              <ExternalLink className="size-3" />
            </button>
          )
        }
      >
        <SettingRow
          label="批准策略"
          description={
            <>
              选择 Codex 何时请求批准
              <OriginNote keyPath="approval_policy" />
            </>
          }
          note={
            granularPolicy
              ? "当前 config.toml 使用了精细批准规则，此处无法完整表示；请直接编辑 config.toml。"
              : undefined
          }
          control={
            <Select
              aria-label="批准策略"
              value={granularPolicy ? null : ((approvalPolicy as string | null) ?? null)}
              options={allowed(APPROVAL_POLICIES, requirements?.allowedApprovalPolicies)}
              disabled={granularPolicy}
              onValueChange={(value) => write("approval_policy", value)}
            />
          }
        />

        <SettingRow
          label="沙盒设置"
          description={
            <>
              选择 Codex 运行命令时的权限范围
              <OriginNote keyPath="sandbox_mode" />
            </>
          }
          control={
            <Select
              aria-label="沙盒设置"
              value={config.sandboxMode ?? null}
              options={allowed(SANDBOX_MODES, requirements?.allowedSandboxModes)}
              onValueChange={(value) => write("sandbox_mode", value)}
            />
          }
        />

        <SettingRow
          label="网页搜索"
          description={
            <>
              选择 Codex 访问网络的方式
              <OriginNote keyPath="web_search" />
            </>
          }
          control={
            <Select
              aria-label="网页搜索"
              value={config.webSearch ?? null}
              options={allowed(WEB_SEARCH_MODES, requirements?.allowedWebSearchModes)}
              onValueChange={(value) => write("web_search", value)}
            />
          }
        />

        <SettingRow
          label="输出详细程度"
          description={
            <>
              选择 Codex 回复包含细节的详细程度
              <OriginNote keyPath="model_verbosity" />
            </>
          }
          control={
            <Select
              aria-label="输出详细程度"
              value={config.modelVerbosity ?? null}
              options={VERBOSITY}
              onValueChange={(value) => write("model_verbosity", value)}
            />
          }
        />

        <SettingRow
          label="推理摘要"
          description={
            <>
              选择 Codex 总结其推理的方式
              <OriginNote keyPath="model_reasoning_summary" />
            </>
          }
          control={
            <Select
              aria-label="推理摘要"
              value={config.modelReasoningSummary ?? null}
              options={REASONING_SUMMARY}
              onValueChange={(value) => write("model_reasoning_summary", value)}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="模型功能">
        <SettingRow
          label="默认模型"
          description={
            <>
              新对话默认使用的模型
              <OriginNote keyPath="model" />
            </>
          }
          control={
            <Select
              aria-label="默认模型"
              value={config.model ?? null}
              options={state.models.map((model) => ({
                value: model.model,
                label: model.displayName,
                hint: model.description,
              }))}
              disabled={state.models.length === 0}
              onValueChange={(value) => write("model", value)}
            />
          }
          note={state.models.length === 0 ? "模型列表尚未加载。" : undefined}
        />

        <SettingRow
          label="默认推理强度"
          description={
            <>
              新对话默认使用的推理强度
              <OriginNote keyPath="model_reasoning_effort" />
            </>
          }
          control={
            <Select
              aria-label="默认推理强度"
              value={config.modelReasoningEffort ?? null}
              options={effortOptionsFor(state.models, config.model ?? null)}
              onValueChange={(value) => write("model_reasoning_effort", value)}
            />
          }
        />
      </SettingsSection>

      {error && <p className="text-xs text-destructive">写入配置失败：{error}</p>}
    </>
  );
}

/// Efforts are per-model, so offer the selected model's list rather than a
/// fixed one that might name values the model rejects.
function effortOptionsFor(
  models: { model: string; supportedReasoningEfforts: { reasoningEffort: string; description: string }[] }[],
  model: string | null,
): SelectOption<string>[] {
  const entry = models.find((candidate) => candidate.model === model);
  return (entry?.supportedReasoningEfforts ?? []).map((option) => ({
    value: option.reasoningEffort,
    label: option.reasoningEffort,
    hint: option.description,
  }));
}
