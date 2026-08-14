//! Project list persistence — Codex Desktop's own app-local state, per
//! ADR-0012. Deliberately not `$CODEX_HOME`: this is sidebar chrome (which
//! folders are pinned, in what order), not Codex config/auth/rollout data.
//!
//! Kept as a hand-rolled JSON file rather than pulling in a store plugin —
//! the format is tiny (`Vec<Project>`) and this avoids a dependency whose
//! exact API surface would need its own research pass in this increment.

use std::path::PathBuf;

use serde::Deserialize;
use serde::Serialize;
use tauri::AppHandle;
use tauri::Manager;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub path: String,
    /// Directory basename, shown in the sidebar (matches the Official App's
    /// "pi", "casdoor" style labels — see reference screenshots).
    pub name: String,
    pub added_at_ms: i64,
}

pub struct ProjectStore {
    file_path: PathBuf,
    projects: RwLock<Vec<Project>>,
}

impl ProjectStore {
    /// Loads (or lazily creates) the project list from the app-local data
    /// directory. Corrupt/unreadable files fall back to an empty list rather
    /// than failing app startup over sidebar state.
    pub fn load(app_handle: &AppHandle) -> anyhow::Result<Self> {
        let dir = app_handle
            .path()
            .app_local_data_dir()
            .map_err(|err| anyhow::anyhow!("failed to resolve app-local data dir: {err}"))?;
        std::fs::create_dir_all(&dir)?;
        let file_path = dir.join("projects.json");

        let projects = std::fs::read_to_string(&file_path)
            .ok()
            .and_then(|contents| serde_json::from_str::<Vec<Project>>(&contents).ok())
            .unwrap_or_default();

        Ok(Self {
            file_path,
            projects: RwLock::new(projects),
        })
    }

    pub async fn list(&self) -> Vec<Project> {
        self.projects.read().await.clone()
    }

    /// Adds a project by absolute path if not already present (matched by
    /// path). Returns the existing or newly-created entry.
    pub async fn add(&self, path: String) -> anyhow::Result<Project> {
        let mut projects = self.projects.write().await;
        if let Some(existing) = projects.iter().find(|project| project.path == path) {
            return Ok(existing.clone());
        }

        let name = PathBuf::from(&path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());

        let project = Project {
            id: uuid_like_id(),
            path,
            name,
            added_at_ms: now_ms(),
        };
        projects.push(project.clone());
        self.persist(&projects)?;
        Ok(project)
    }

    pub async fn remove(&self, id: &str) -> anyhow::Result<()> {
        let mut projects = self.projects.write().await;
        projects.retain(|project| project.id != id);
        self.persist(&projects)
    }

    fn persist(&self, projects: &[Project]) -> anyhow::Result<()> {
        let contents = serde_json::to_string_pretty(projects)?;
        std::fs::write(&self.file_path, contents)?;
        Ok(())
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

/// Good-enough unique id without pulling in a `uuid` dependency for one
/// call site: timestamp plus a process-local counter.
fn uuid_like_id() -> String {
    static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("proj_{}_{counter}", now_ms())
}
