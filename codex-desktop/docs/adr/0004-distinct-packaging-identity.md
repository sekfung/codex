# Codex Desktop uses a packaging identity distinct from the Official App

The Official App is identified on disk by macOS bundle identifier `com.openai.codex` and filename `Codex.app` (`cli/src/desktop_app/mac.rs`), and by an `OpenAI.Codex_*` package family on Windows. Codex Desktop displays as "Codex" in its own UI (matching Official App branding) but ships under a different bundle identifier and does not install as `Codex.app`, so the two apps never collide on disk or in package-identity checks.

**Why:** reusing the Official App's identifier/filename would let either app overwrite or shadow the other on install, and would make `codex app`'s existing `find_existing_codex_app_path`/bundle-identifier check (left untouched per ADR-0001) misidentify Codex Desktop as the Official App or vice versa. This is purely a disk/system-identity concern — it doesn't affect in-app branding.
