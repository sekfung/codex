# Codex Desktop v1 ships basic light/dark/system theming, not full theme customization

Reference screenshots of the Official App's Appearance settings show a full theme-customization system: light/dark/system presets plus a JSON-diff-style editor for per-token overrides (accent/background/foreground colors, contrast) and font selection. Codex Desktop v1 implements only the three-state light/dark/system switch; the custom token editor and font picker are deferred to v2.

**Why:** the token-diff editor is substantial standalone UI work that doesn't gate the core "have a working chat/approval/project experience" goal — sequencing it after v1 ships lets the rest of the app land sooner.
