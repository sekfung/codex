//! Codex Desktop — Tauri 2 shell.
//!
//! See `codex-desktop/docs/adr/`: starts an in-process `codex-app-server`
//! (ADR-0002) against the default `$CODEX_HOME` (ADR-0008), hands it to
//! `bridge::spawn_bridge` so Tauri commands (`commands.rs`) can drive it and
//! server events reach the frontend, and manages the Project list
//! (`projects.rs`, ADR-0012). Settings screens and most of the item/approval
//! rendering richness described in the later ADRs (0013-0018) live entirely
//! in `ui/` — this file only wires the backend.

mod approval_mode;
mod bridge;
mod config_settings;
mod commands;
mod composer;
mod integrations;
mod projects;

use std::sync::Arc;

use codex_app_server_client::DEFAULT_IN_PROCESS_CHANNEL_CAPACITY;
use codex_app_server_client::EnvironmentManager;
use codex_app_server_client::ExecServerRuntimePaths;
use codex_app_server_client::InProcessAppServerClient;
use codex_app_server_client::InProcessClientStartArgs;
use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::RequestId;
use codex_arg0::Arg0DispatchPaths;
use codex_config::CloudConfigBundleLoader;
use codex_config::LoaderOverrides;
use codex_core::config::Config;
use codex_feedback::CodexFeedback;
use codex_protocol::protocol::SessionSource;
use tauri::Manager as _;

const CLIENT_NAME: &str = "codex-desktop";

/// Matches the private `TOKIO_WORKER_STACK_SIZE_BYTES` in `codex_arg0` — kept
/// in sync intentionally, not a magic number. `codex-core`'s async call graphs
/// (thread orchestration, tool execution, MCP) are deep enough to overflow
/// tokio's default 2 MiB worker stack; the CLI/TUI/exec avoid this by routing
/// through `codex_arg0::arg0_dispatch_or_else`, which builds its runtime with
/// this stack size. Codex Desktop can't use that wrapper directly (it also
/// spawns a fresh OS thread for `main_fn`, and on Linux the GTK/webkit2gtk
/// event loop `tauri::Builder::run` drives must stay on the real process main
/// thread), so this replicates just the stack-size half of what it does.
const TOKIO_WORKER_STACK_SIZE_BYTES: usize = 16 * 1024 * 1024;

/// Starts the in-process app-server and performs one round-trip request to
/// prove the wiring is correct. Returns the client so callers can keep using
/// it; on any setup failure, logs and returns `None` rather than crashing the
/// whole desktop shell (the window should still open even if this fails, so
/// the user gets a visible error state instead of a silent process exit).
async fn start_app_server_client() -> Option<InProcessAppServerClient> {
    // Real default `$CODEX_HOME` resolution (ADR-0008) — same code path the
    // CLI uses, honors the `CODEX_HOME` env var, no hardcoded temp dir.
    let config = match Config::load_default_with_cli_overrides(Vec::new()).await {
        Ok(config) => config,
        Err(err) => {
            tracing::error!(%err, "failed to load default Codex config");
            return None;
        }
    };
    let config = Arc::new(config);

    // TODO(desktop-app): this bypasses `codex_arg0::arg0_dispatch()`, which
    // the CLI uses to handle argv0-aliased re-exec (sandbox helper,
    // apply_patch, execve wrapper). Tauri's binary isn't invoked through that
    // aliasing today, so `codex_self_exe` is just this process's own path.
    // Revisit if/when sandboxed command execution needs the full dispatch.
    let arg0_paths = Arg0DispatchPaths {
        codex_self_exe: std::env::current_exe().ok(),
        codex_linux_sandbox_exe: None,
        main_execve_wrapper_exe: None,
    };

    let local_runtime_paths = match ExecServerRuntimePaths::from_optional_paths(
        arg0_paths.codex_self_exe.clone(),
        arg0_paths.codex_linux_sandbox_exe.clone(),
    ) {
        Ok(paths) => paths,
        Err(err) => {
            tracing::error!(%err, "failed to resolve exec-server runtime paths");
            return None;
        }
    };

    let environment_manager = match EnvironmentManager::from_codex_home(
        config.codex_home.clone(),
        Some(local_runtime_paths),
        config.http_client_factory(),
    )
    .await
    {
        Ok(manager) => manager,
        Err(err) => {
            tracing::error!(%err, "failed to build environment manager");
            return None;
        }
    };

    let state_db = codex_core::init_state_db(&config).await;

    // TODO(desktop-app): `SessionSource::Custom` is the precedented escape
    // hatch for named non-built-in surfaces (see `SessionSource::Custom`
    // usages for "atlas"/"chatgpt" in `rollout/src/lib.rs`) — not a hack, but
    // still a placeholder. A first-class `SessionSource::Desktop` variant
    // (mirroring `SessionSource::VSCode`) may be worth adding later for
    // product-restriction/analytics semantics once this ships for real; that
    // would mean editing `protocol/src/protocol.rs`, which is out of scope
    // for this additive-only scaffold (ADR-0001) — flagging for a human call.
    let session_source = SessionSource::Custom(CLIENT_NAME.to_string());

    let start_args = InProcessClientStartArgs {
        arg0_paths,
        config,
        cli_overrides: Vec::new(),
        loader_overrides: LoaderOverrides::default(),
        strict_config: false,
        cloud_config_bundle: CloudConfigBundleLoader::default(),
        feedback: CodexFeedback::new(),
        log_db: None,
        state_db,
        environment_manager: Arc::new(environment_manager),
        config_warnings: Vec::new(),
        session_source,
        enable_codex_api_key_env: true,
        client_name: CLIENT_NAME.to_string(),
        client_version: env!("CARGO_PKG_VERSION").to_string(),
        experimental_api: true,
        mcp_server_openai_form_elicitation: false,
        opt_out_notification_methods: Vec::new(),
        channel_capacity: DEFAULT_IN_PROCESS_CHANNEL_CAPACITY,
    };

    let client = match InProcessAppServerClient::start(start_args).await {
        Ok(client) => client,
        Err(err) => {
            tracing::error!(%err, "failed to start in-process app-server");
            return None;
        }
    };

    // Round-trip proof that the wiring works end-to-end.
    match client
        .request(ClientRequest::ConfigRequirementsRead {
            request_id: RequestId::Integer(0),
            params: None,
        })
        .await
    {
        Ok(Ok(result)) => {
            tracing::info!(?result, "app-server round-trip succeeded (config/requirements/read)");
        }
        Ok(Err(err)) => {
            tracing::error!(?err, "app-server returned a JSON-RPC error for startup probe");
        }
        Err(err) => {
            tracing::error!(%err, "app-server startup probe transport failure");
        }
    }

    Some(client)
}

fn main() {
    tracing_subscriber::fmt::init();

    // Tauri lazily creates its own default-config async runtime the first
    // time `tauri::async_runtime::spawn` is used unless we install one first.
    // Installing ours here (before `.setup()` can run) ensures every task
    // spawned through `tauri::async_runtime` — including app-server's
    // internals — gets the larger worker stacks.
    //
    // IMPORTANT: this binding must outlive `run()`. `async_runtime::set` only
    // hands Tauri a `Handle`; we stay the sole owner of the `Runtime` itself.
    // Moving it into the `setup` closure would drop it when that `FnOnce` is
    // consumed, silently shutting the runtime down — after which every async
    // command (ours *and* plugin ones like `plugin:dialog|open`) is spawned
    // onto a dead handle and never runs, hanging with no error at all.
    let async_runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(TOKIO_WORKER_STACK_SIZE_BYTES)
        .build()
        .expect("failed to build tokio runtime");
    tauri::async_runtime::set(async_runtime.handle().clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let project_store = projects::ProjectStore::load(app.handle())
                .expect("failed to load Project list from app-local storage");
            app.manage(project_store);

            // Block the (synchronous) setup hook on client startup so every
            // command handler can rely on `AppServerBridge` already being
            // managed once the window is up — no "still starting" race to
            // handle in every command. Config load + in-process app-server
            // startup is normally sub-second; acceptable to block on here.
            match tauri::async_runtime::block_on(start_app_server_client()) {
                Some(client) => {
                    let bridge = bridge::spawn_bridge(client, app.handle().clone());
                    app.manage(bridge);
                }
                None => {
                    tracing::error!(
                        "app-server failed to start; Project/thread/turn commands will be unavailable this session"
                    );
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::add_project,
            commands::remove_project,
            commands::list_threads,
            commands::set_thread_name,
            commands::archive_thread,
            commands::unarchive_thread,
            commands::delete_thread,
            commands::search_threads,
            commands::read_account,
            commands::read_account_rate_limits,
            commands::list_models,
            commands::set_model,
            commands::start_thread,
            commands::set_approval_mode,
            commands::resume_thread,
            commands::fork_thread,
            composer::send_turn,
            composer::list_skills,
            composer::compact_thread,
            composer::start_review,
            composer::context_usage,
            commands::interrupt_turn,
            commands::resolve_command_execution_approval,
            commands::resolve_file_change_approval,
            commands::resolve_permissions_approval,
            commands::reject_approval,
            config_settings::read_config,
            config_settings::read_config_requirements,
            config_settings::read_default_approval_mode,
            config_settings::write_config_value,
            config_settings::write_config_batch,
            config_settings::set_default_approval_mode,
            config_settings::config_file_path,
            config_settings::open_path_in_os,
            integrations::list_mcp_servers,
            integrations::mcp_server_login,
            integrations::reload_mcp_servers,
            integrations::list_hooks,
            integrations::list_plugins,
            integrations::list_installed_plugins,
            integrations::install_plugin,
            integrations::uninstall_plugin,
            integrations::add_marketplace,
            integrations::remove_marketplace,
            integrations::upgrade_marketplace,
            integrations::read_account_usage,
            integrations::start_account_login,
            integrations::cancel_account_login,
            integrations::logout_account,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex Desktop");
}
