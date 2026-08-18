# Codex behavior settings persist to `config.toml`; only desktop chrome stays app-local

Two earlier ADRs pull in opposite directions: ADR-0008 shares `$CODEX_HOME` with the CLI, while ADR-0012 keeps the Project list in Tauri's app-local storage. The dividing line, applied to the settings surface:

- **Persists to `config.toml`** (via `config/read`, `config/value/write`, `config/batchWrite`): anything that changes how Codex *behaves* — default approval policy and sandbox settings, default model and reasoning effort, web-search access, output verbosity, reasoning summaries, hooks, agent environment. The CLI honors these too, and a user who sets "full access" in the desktop app should not find the CLI still asking.
- **Stays app-local** (ADR-0012): anything that is only about this desktop window — which Projects are pinned and in what order, theme mode, window/layout state. The CLI has no stake in these and would be confused by them.

The Official App's Config screen supports this split directly: it exposes 批准策略 / 沙盒设置 / 网页搜索 / 输出详细程度 / 推理摘要 as settings and links out to "打开 config.toml" (reference screenshot `04-settings-config.png`), i.e. it presents itself as a GUI over the same file.

**Consequences:** the composer's approval-mode and model selectors (currently per-thread, resetting on restart) become *overrides* of a persisted default rather than the only place the value lives — changing one in the composer should not silently rewrite the global default, and the settings screen is where the default is edited. Theme mode stays in `localStorage` where ADR-0009 put it, since it is desktop chrome.
