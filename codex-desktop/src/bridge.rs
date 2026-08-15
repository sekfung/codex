//! Actor that owns the in-process app-server client for its whole lifetime.
//!
//! `InProcessAppServerClient::next_event` needs `&mut self`, while
//! `request`/`resolve_server_request`/`reject_server_request` only need
//! `&self` — but there's no way to hand out `&self` access to Tauri commands
//! once the client has been moved into a task that owns it exclusively. This
//! actor sidesteps that by owning the client in one task and accepting work
//! over a channel, rather than trying to share the client itself.
//!
//! One real limitation, left as-is for this increment: jobs are processed one
//! at a time inside the same `select!` loop that drains server events, so a
//! slow request delays the next event delivery. Every request this bridge
//! makes today is a fast round-trip (list/start/resume/fork/approve), so this
//! hasn't been a problem in practice, but a way out if it ever is: move each
//! `client.request(..)` call onto its own detached task via `Arc<..>` +
//! `tokio::sync::Mutex`, or give the client a cheap `Clone`.

use std::sync::atomic::AtomicI64;
use std::sync::atomic::Ordering;

use codex_app_server_client::InProcessAppServerClient;
use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::RequestId;
use serde_json::Value as JsonValue;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::mpsc;
use tokio::sync::oneshot;

/// Event name emitted to the frontend for every server-initiated
/// notification or request. Payload shape: `{ "method": string, "params":
/// unknown }` — deliberately untyped on the Rust side (see module docs on
/// why responses/events are forwarded as raw JSON in this increment).
pub const APP_SERVER_EVENT: &str = "codex-desktop://app-server-event";

enum BridgeJob {
    Request {
        request: ClientRequest,
        respond_to: oneshot::Sender<Result<JsonValue, String>>,
    },
    ResolveServerRequest {
        request_id: RequestId,
        result: JsonValue,
        respond_to: oneshot::Sender<Result<(), String>>,
    },
    RejectServerRequest {
        request_id: RequestId,
        message: String,
        respond_to: oneshot::Sender<Result<(), String>>,
    },
}

/// Handle stored in Tauri-managed state. Cheap to clone (just a channel
/// sender), so every command invocation can hold its own copy.
#[derive(Clone)]
pub struct AppServerBridge {
    job_tx: mpsc::UnboundedSender<BridgeJob>,
    next_request_id: std::sync::Arc<AtomicI64>,
}

impl AppServerBridge {
    pub fn next_request_id(&self) -> RequestId {
        RequestId::Integer(self.next_request_id.fetch_add(1, Ordering::Relaxed))
    }

    /// Sends a request and returns the raw JSON-RPC result. Errors are
    /// stringified (transport failures, JSON-RPC error responses, and "the
    /// bridge task is gone" are all collapsed into one `Err(String)`) — good
    /// enough for a v1 UI to show a toast; a future pass can thread through
    /// richer error shapes if the UI needs to branch on them.
    pub async fn request(&self, request: ClientRequest) -> Result<JsonValue, String> {
        let (respond_to, response) = oneshot::channel();
        self.job_tx
            .send(BridgeJob::Request {
                request,
                respond_to,
            })
            .map_err(|_| "app-server bridge task is gone".to_string())?;
        response
            .await
            .map_err(|_| "app-server bridge dropped the response channel".to_string())?
    }

    pub async fn resolve_server_request(
        &self,
        request_id: RequestId,
        result: JsonValue,
    ) -> Result<(), String> {
        let (respond_to, response) = oneshot::channel();
        self.job_tx
            .send(BridgeJob::ResolveServerRequest {
                request_id,
                result,
                respond_to,
            })
            .map_err(|_| "app-server bridge task is gone".to_string())?;
        response
            .await
            .map_err(|_| "app-server bridge dropped the response channel".to_string())?
    }

    pub async fn reject_server_request(
        &self,
        request_id: RequestId,
        message: String,
    ) -> Result<(), String> {
        let (respond_to, response) = oneshot::channel();
        self.job_tx
            .send(BridgeJob::RejectServerRequest {
                request_id,
                message,
                respond_to,
            })
            .map_err(|_| "app-server bridge task is gone".to_string())?;
        response
            .await
            .map_err(|_| "app-server bridge dropped the response channel".to_string())?
    }
}

/// Moves `client` into a dedicated task and returns a cheap handle to it.
/// The task runs for the rest of the process lifetime.
pub fn spawn_bridge(client: InProcessAppServerClient, app_handle: AppHandle) -> AppServerBridge {
    let (job_tx, job_rx) = mpsc::unbounded_channel::<BridgeJob>();
    tauri::async_runtime::spawn(run_bridge_loop(client, job_rx, app_handle));
    AppServerBridge {
        job_tx,
        next_request_id: std::sync::Arc::new(AtomicI64::new(1)),
    }
}

async fn run_bridge_loop(
    mut client: InProcessAppServerClient,
    mut job_rx: mpsc::UnboundedReceiver<BridgeJob>,
    app_handle: AppHandle,
) {
    loop {
        tokio::select! {
            job = job_rx.recv() => {
                let Some(job) = job else {
                    // All `AppServerBridge` handles dropped (app shutting down).
                    let _ = client.shutdown().await;
                    return;
                };
                handle_job(&client, job).await;
            }
            event = client.next_event() => {
                let Some(event) = event else {
                    tracing::warn!("app-server in-process event stream ended");
                    return;
                };
                emit_event(&app_handle, event.into());
            }
        }
    }
}

async fn handle_job(client: &InProcessAppServerClient, job: BridgeJob) {
    match job {
        BridgeJob::Request {
            request,
            respond_to,
        } => {
            let outcome = match client.request(request).await {
                Ok(Ok(result)) => Ok(result),
                Ok(Err(err)) => Err(format!("{} (code {})", err.message, err.code)),
                Err(err) => Err(format!("transport error: {err}")),
            };
            let _ = respond_to.send(outcome);
        }
        BridgeJob::ResolveServerRequest {
            request_id,
            result,
            respond_to,
        } => {
            let outcome = client
                .resolve_server_request(request_id, result)
                .await
                .map_err(|err| format!("failed to resolve approval: {err}"));
            let _ = respond_to.send(outcome);
        }
        BridgeJob::RejectServerRequest {
            request_id,
            message,
            respond_to,
        } => {
            let outcome = client
                .reject_server_request(
                    request_id,
                    JSONRPCErrorError {
                        code: -32000,
                        message,
                        data: None,
                    },
                )
                .await
                .map_err(|err| format!("failed to reject approval: {err}"));
            let _ = respond_to.send(outcome);
        }
    }
}

/// Forwards a server-initiated event to the frontend. Notifications and
/// requests both become `{ method, params }` payloads (a `ServerRequest`
/// additionally needs `request_id` echoed back on resolve/reject, so it's
/// included as `params.requestId` — see the TODO below).
fn emit_event(app_handle: &AppHandle, event: codex_app_server_client::AppServerEvent) {
    use codex_app_server_client::AppServerEvent;

    let payload = match event {
        AppServerEvent::ServerNotification(notification) => serde_json::json!({
            "kind": "notification",
            "notification": *notification,
        }),
        AppServerEvent::ServerRequest(request) => {
            // `ServerRequest::id()` gives the `RequestId` directly; the
            // serialized `request` payload also carries it as `"id"`
            // (`#[serde(tag = "method")]` on the enum, `#[serde(rename =
            // "id")]` on the field — see `server_request_definitions!` in
            // app-server-protocol) but pulling it out explicitly here saves
            // the frontend from needing to know that shape just to echo the
            // id back on resolve/reject.
            let request_id = request.id().clone();
            serde_json::json!({
                "kind": "request",
                "requestId": request_id,
                "request": *request,
            })
        }
        AppServerEvent::Lagged { skipped } => serde_json::json!({
            "kind": "lagged",
            "skipped": skipped,
        }),
        AppServerEvent::Disconnected { message } => serde_json::json!({
            "kind": "disconnected",
            "message": message,
        }),
    };

    if let Err(err) = app_handle.emit(APP_SERVER_EVENT, payload) {
        tracing::error!(%err, "failed to emit app-server event to frontend");
    }
}
