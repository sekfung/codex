import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppServerEventEnvelope,
  ApprovalMode,
  ConfigReadResponse,
  ConfigRequirementsReadResponse,
  ModelListResponse,
  Project,
  ReasoningEffort,
  SettingEdit,
  ThreadResumeResponse,
} from "./types";

/// `thread/fork` returns the same envelope shape as resume, plus more fields
/// we don't consume yet — only `thread.id` is needed to switch to the fork.
type ThreadForkResponse = ThreadResumeResponse;

// Mirrors `bridge::APP_SERVER_EVENT` in the Rust backend — keep in sync.
const APP_SERVER_EVENT = "codex-desktop://app-server-event";

export function onAppServerEvent(
  handler: (event: AppServerEventEnvelope) => void,
): Promise<() => void> {
  return listen<AppServerEventEnvelope>(APP_SERVER_EVENT, (event) => handler(event.payload));
}

// -- Projects (ADR-0012) -----------------------------------------------------

export const listProjects = () => invoke<Project[]>("list_projects");
export const addProject = (path: string) => invoke<Project>("add_project", { path });
export const removeProject = (id: string) => invoke<void>("remove_project", { id });
// Uses `@tauri-apps/plugin-dialog` directly (gated by the `dialog:default`
// capability) instead of a custom Rust command — this is the plugin's own
// well-tested IPC path, not a hand-rolled oneshot-channel wrapper around it.
export const pickProjectFolder = () => open({ directory: true, multiple: false });

// -- Threads ------------------------------------------------------------

export const listThreads = (projectPath: string) =>
  invoke<unknown>("list_threads", { projectPath });
export const startThread = (
  cwd: string,
  approvalMode?: ApprovalMode,
  model?: string | null,
  effort?: ReasoningEffort | null,
) =>
  invoke<unknown>("start_thread", {
    cwd,
    approvalMode: approvalMode ?? null,
    model: model ?? null,
    effort: effort ?? null,
  });
export const resumeThread = (threadId: string) =>
  invoke<ThreadResumeResponse>("resume_thread", { threadId });
export const forkThread = (threadId: string, lastTurnId?: string | null) =>
  invoke<ThreadForkResponse>("fork_thread", { threadId, lastTurnId: lastTurnId ?? null });

// ADR-0016 layer 1. The mode -> (approval policy, permission profile,
// reviewer) mapping lives in Rust (`src/approval_mode.rs`); the frontend only
// names the mode.
export const setApprovalMode = (threadId: string, approvalMode: ApprovalMode) =>
  invoke<unknown>("set_approval_mode", { threadId, approvalMode });

// Model picker, following the same two-layer shape: applied to the active
// thread here, and carried onto new threads by `startThread`.
export const listModels = () => invoke<ModelListResponse>("list_models");

export const setModel = (
  threadId: string,
  model: string | null,
  effort: ReasoningEffort | null,
) => invoke<unknown>("set_model", { threadId, model, effort });

// -- Settings / config.toml (ADR-0020) ---------------------------------------
// Behavior settings live in `config.toml` so the CLI honors them too; desktop
// chrome (Project list, theme mode) stays app-local.

export const readConfig = () => invoke<ConfigReadResponse>("read_config");
export const readConfigRequirements = () =>
  invoke<ConfigRequirementsReadResponse>("read_config_requirements");

export const writeConfigValue = (edit: SettingEdit) =>
  invoke<unknown>("write_config_value", { edit });
export const writeConfigBatch = (edits: SettingEdit[]) =>
  invoke<unknown>("write_config_batch", { edits });

/// The persisted *default* approval mode, as opposed to the composer's
/// per-thread override. `null` when `config.toml` holds a combination the
/// 3-preset selector can't express — the mapping lives in Rust
/// (`src/approval_mode.rs`) so the forward and reverse directions can't drift.
export const readDefaultApprovalMode = () =>
  invoke<ApprovalMode | null>("read_default_approval_mode");

/// Writes the default approval mode. One selector value expands to three
/// config keys, written atomically in Rust.
export const setDefaultApprovalMode = (approvalMode: ApprovalMode) =>
  invoke<unknown>("set_default_approval_mode", { approvalMode });

export const configFilePath = () => invoke<string>("config_file_path");
export const openPathInOs = (path: string) => invoke<void>("open_path_in_os", { path });

// -- Turns --------------------------------------------------------------

export const sendTurn = (threadId: string, text: string) =>
  invoke<unknown>("send_turn", { threadId, text });
export const interruptTurn = (threadId: string, turnId: string) =>
  invoke<unknown>("interrupt_turn", { threadId, turnId });

// -- Approvals (ADR-0015 / ADR-0016) -----------------------------------------

export const resolveCommandExecutionApproval = (
  requestId: unknown,
  decision: Record<string, unknown>,
) => invoke<void>("resolve_command_execution_approval", { requestId, decision });

export const resolveFileChangeApproval = (
  requestId: unknown,
  decision: Record<string, unknown>,
) => invoke<void>("resolve_file_change_approval", { requestId, decision });

export const resolvePermissionsApproval = (
  requestId: unknown,
  response: Record<string, unknown>,
) => invoke<void>("resolve_permissions_approval", { requestId, response });

export const rejectApproval = (requestId: unknown, message: string) =>
  invoke<void>("reject_approval", { requestId, message });
