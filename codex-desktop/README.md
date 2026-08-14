# codex-desktop

Rust + Tauri 2 backend for **Codex Desktop**, an additive, independently-launched desktop client for Codex. See `CONTEXT.md` and `docs/adr/` in this directory for the design decisions behind this crate — start there before changing anything here.

This is currently a wiring skeleton: it embeds `codex-app-server` in-process (`codex-app-server-client`), performs a startup round-trip request to prove the connection works, and renders a placeholder UI from `ui/`. It does not yet implement the product surface described in the ADRs.

Lives at repo-root (sibling to `codex-cli/`), not under `codex-rs/` — see ADR-0011.

## Layout

- `src/main.rs` — Tauri entry point + in-process app-server startup.
- `ui/` — React + TypeScript + Vite frontend (separate pnpm package, registered in the root `pnpm-workspace.yaml`).
- `tauri.conf.json` — Tauri configuration (product name, bundle identifier, window, frontend build wiring).

## Running (dev)

```sh
# from codex-desktop/ui
pnpm install
pnpm dev        # starts the Vite dev server

# from codex-desktop (separate terminal)
cargo run -p codex-desktop
```

Or, with `tauri-cli` installed (`cargo install tauri-cli --version "^2.0.0" --locked`), a single command from `codex-desktop/`:

```sh
cargo tauri dev
```

See ADR-0001: Bazel/CI integration is intentionally deferred for now.
