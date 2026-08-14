# Codex Desktop self-updates via Tauri's built-in updater

Codex Desktop uses the Tauri updater plugin (signed update bundles checked/applied by the app itself) rather than reusing the CLI's `codex update` logic or version numbering.

**Why:** the CLI and Codex Desktop are already separate binaries with separate distribution channels (npm/curl/Homebrew vs. platform installers, per ADR-0001/ADR-0004); the Tauri updater is the platform-standard mechanism for desktop-app self-update (signature verification, staged rollout) and requires no coupling to CLI release infrastructure.
