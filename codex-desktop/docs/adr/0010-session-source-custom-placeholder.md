# Codex Desktop identifies itself via `SessionSource::Custom("codex-desktop")`

Codex Desktop reports `SessionSource::Custom("codex-desktop")` to app-server rather than a dedicated first-class enum variant (like the existing `VSCode` variant).

**Why:** `SessionSource::Custom` is an existing, precedented mechanism (already used for `"atlas"`/`"chatgpt"` elsewhere) that needs zero changes to `protocol/src/protocol.rs`, staying fully within ADR-0001's additive-only footprint. A first-class `SessionSource::Desktop` variant would give cleaner analytics/product-restriction semantics but isn't worth the shared-file edit until desktop-specific product restrictions or analytics segmentation become an actual requirement.

**Consequences:** revisit if/when analytics or product-gating needs to distinguish Codex Desktop from other `Custom` sources at the protocol level rather than by string value.
