# Commit attribution changes agent behaviour but no client can read whether it is on

Reported upward per ADR-0021. Unlike gap 0001, this one is small and self-contained: a single boolean, already fetched, that no client can observe.

## What happens today

`commit_attribution_enabled` is the sole field this repo deserializes from the ChatGPT account settings endpoint (`backend-client/src/types.rs`, `GET /wham/settings/user` via `backend-client/src/client.rs`). `ext/git-attribution/src/policy.rs` resolves it into a `GitAttributionPolicy`, and when enabled the extension injects world state instructing the model that commit messages must end with `Co-authored-by: Codex <noreply@openai.com>`.

`codex_git_attribution::install` is called unconditionally in `thread_extensions()` (`app-server/src/extensions.rs`), and the in-process path runs the same `MessageProcessor` — so this applies to Codex Desktop exactly as it does to the TUI.

The injected block is tagged `<git_attribution>`, which appears in `CONTEXTUAL_DEVELOPER_PREFIXES` (`core/src/event_mapping.rs`) — the list of synthetic developer messages filtered out of the visible transcript.

## The gap

The chain is complete and invisible at both ends:

- **No RPC exposes the resolved policy.** The state lives inside the extension. Grepping the v2 protocol for `commit_attribution` or `git_attribution` returns nothing.
- **The transcript deliberately hides the instruction**, correctly — it is developer scaffolding, not conversation.
- **The fetch is GET-only.** There is no write path to the account settings endpoint from here, so no client could offer a toggle even if it wanted to.

So a user sees `Co-authored-by: Codex` appear in commits the agent writes, with nothing anywhere in the product explaining where it came from or how to stop it. The only way to find out is to read the source.

## What would close it

A read-only accessor is enough — something like `account/settings/read` returning the resolved `commitAttributionEnabled`, or the field folded into an existing account response. A write path is explicitly *not* wanted: the value belongs to the ChatGPT account, and the correct place to change it is where it is stored.

With a read, Codex Desktop's Git screen gains an honest first row ("提交署名：已启用（来自 ChatGPT 账号）") instead of the behavioural description it carries now.

## Why this is worth more than its size suggests

It is the one confirmed case of an account setting silently reaching into local behaviour. ADR-0024 draws the line between engine settings and account settings on the assumption that account settings do not affect what happens on this machine. This is the exception, and the exception is currently unobservable — which is what makes it worth naming rather than tolerating.
