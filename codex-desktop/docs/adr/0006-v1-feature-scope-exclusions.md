# Codex Desktop v1 excludes headless exec, Cloud tasks, remote control, realtime voice, computer control, and browser integration

Following the general boundary set in ADR-0003, v1 of Codex Desktop excludes: a GUI entry point for `codex exec` (headless/fire-and-forget runs), OpenAI Cloud tasks (`codex cloud` / cloud-tasks, surfaced in the Official App's sidebar as "拉取请求"/"已安排"), remote control (`remoteControl/*`, letting another device drive this machine), realtime voice (`thread/realtime/*`), computer-use/GUI automation ("电脑操控" in the Official App's Settings), and browser integration ("浏览器" in the Official App's Settings).

Confirmed against reference screenshots: the sidebar does **not** show placeholder entries for Pull Requests/Scheduled in v1 — they're omitted entirely, not shown disabled, keeping the excluded surfaces fully absent rather than half-built.

Two areas seen in the reference screenshots but *not* excluded — confirmed in scope for v1 because they map directly onto existing repo capability with no new backend work: **Hooks** settings (backed by the existing `codex-hooks` crate) and **Environment**/WSL settings (backed by the CLI's existing `wsl_paths.rs` handling).

**Why:** each excluded item is either a distinct product surface with its own scope (cloud tasks belongs to the chatgpt.com/codex web experience), an operational/scripting concern orthogonal to "align with the Official App's day-to-day experience" (headless exec, remote control), or a substantial standalone feature better sequenced after the core text-based experience ships (voice, computer control, browser integration all need significant new native capability).

**Consequences:** none of these require protocol changes to add later — they're deferred by choice, not blocked by architecture.
