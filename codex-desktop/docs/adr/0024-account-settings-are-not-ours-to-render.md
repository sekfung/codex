# The Official App's settings nav mixes local-engine settings with ChatGPT account settings; Codex Desktop renders only the former

A settings screen copied from the reference screenshots may be backed by either of two different things: configuration this machine's engine reads (`config.toml`, an RPC), or state that lives in the user's ChatGPT account and is served over the backend API. The Official App is a client to both. Codex Desktop, which embeds `codex-app-server` in-process (ADR-0002), is a client only to the first.

So the admission test in ADR-0021 gains a preliminary question: **not just "what is the basis", but "which side is the basis on".** A capability whose only reader is the ChatGPT backend fails the test here even though the screenshot proves it works there.

The Git screen is the worked example. Its seven controls resolve as follows:

- **分支前缀, 拉取请求合并方法, 始终强制推送, 创建草稿拉取请求** — no config key or RPC anywhere in this repo. They configure what ChatGPT does when it pushes branches and opens PRs on the user's behalf; the create-task body this repo sends (`cloud-tasks-client/src/http.rs`) carries `environment_id`, `branch` and `qa_mode` and nothing else, and PRs are only ever *read back* (`pull_requests` on a task). Account side.
- **提交说明, 拉取请求指令** — prompt-injection points for commit-message and PR-description generation. This engine generates neither, so there is no local injection site regardless of where the text is stored.
- **代码审查发送方式** — genuinely local, but a *per-request* parameter rather than a preference: `turn_processor.rs` reads it as `delivery.unwrap_or(Inline)` and no config key backs it. It ships at the review entry point, where the choice is made.

Zero of the seven are renderable as stored settings, so the screen carries no controls at all. It states where each capability actually lives instead.

One capability crosses the line in the other direction and is worth naming: **commit attribution**. It is an account setting (`commit_attribution_enabled`, the sole field this repo deserializes from `/wham/settings/user`), it is read-only from any client here, and `codex_git_attribution::install` is unconditional in `thread_extensions()` — which the in-process path runs too. So it already changes Codex Desktop's behavior, invisibly, and no RPC exposes its state. That is a protocol gap, recorded in `docs/protocol-gaps/`.

**Why:** without this distinction, "the Official App has it" keeps re-arriving as an argument for building controls that cannot work here — a switch wired to nothing is worse than an absent switch, and the user cannot tell the difference by looking. The screenshots cannot show which side a setting is stored on, so the question has to be asked explicitly every time.

**Consequences:** the same reasoning applies to other account-facing nav entries, 使用情况和计费 in particular — though that one is not settled here, since `account/rateLimits/read` may give part of it a local basis. Enabling a nav entry no longer implies shipping controls: an explanatory screen that routes the user to where a capability really lives is a legitimate outcome, and a better one than leaving the entry greyed out with no explanation.
