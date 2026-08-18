# Codex Desktop v1 exposes the full approval decision space

Unlike the initial recommendation (ship a simplified Accept/Accept-for-session/Decline set), v1 exposes UI for every decision variant the protocol supports: for command execution, `Accept | AcceptForSession | AcceptWithExecpolicyAmendment | ApplyNetworkPolicyAmendment | Decline`; for file changes, `Accept | AcceptForSession | Decline | Cancel` (Decline and Cancel are kept distinct — Decline continues the turn, Cancel interrupts it); for permissions, the full `GrantedPermissionProfile`/`PermissionGrantScope` (Turn vs. Session)/`strict_auto_review` surface.

**Why:** deliberate scope call by the human, prioritizing full parity with what the protocol (and presumably the Official App) actually offers over a reduced v1 surface.

**Consequences:** the execpolicy/network-policy amendment paths need UI for showing the proposed policy change before the user accepts it (`proposed_execpolicy_amendment`, `proposed_network_policy_amendments` on `CommandExecutionRequestApprovalParams`) — this is real design surface, not just extra buttons, and isn't designed yet.
