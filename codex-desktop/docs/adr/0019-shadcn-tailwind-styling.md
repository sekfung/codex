# Codex Desktop's UI is built on shadcn/ui + Tailwind, themed with the Official App's own tokens

The hand-written CSS from the scaffolding pass (`ui/src/App.css`) is replaced by Tailwind CSS + shadcn/ui (Radix primitives, copy-into-repo component model). The theme is not shadcn's default neutral palette: it uses the Official App's actual published token values, read directly off its Appearance settings screen (`docs/design-reference/03-settings-appearance.png`), which exposes them as editable hex values:

| Token | Light ("Codex" theme) |
|---|---|
| accent / primary | `#339CFF` |
| background | `#FFFFFF` |
| foreground | `#1A1C1F` |

**Why shadcn over a component library like MUI/Ant:** components are copied into the repo rather than imported from a versioned package, so there is no third-party upgrade treadmill inside a fork we already intend to keep merging upstream into (ADR-0001's whole premise), and every component stays locally editable to match reference screenshots. Radix underneath gives accessible dialog/popover/select behavior we would otherwise hand-roll for the approval cards, mode selector, and settings screens.

**Why the Official App's tokens specifically:** the goal stated from the outset was matching the Official App's look; using its own accent/background/foreground values makes that objective rather than eyeballed.

**Consequences:**
- Dark-theme token values are not yet known — the reference screenshot only exposed the light ("浅色主题") values. Dark mode derives from shadcn's dark scale with the same accent until the Official App's dark values can be read the same way.
- The Official App uses a proprietary font (its font picker shows "Codex"); that asset isn't ours to ship, so a neutral system font stack stands in.
- ADR-0009 still holds: v1 ships light/dark/system switching only, not the per-token customization editor the Official App offers.
