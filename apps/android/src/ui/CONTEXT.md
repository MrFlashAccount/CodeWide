# Shared UI primitives

## Overflow menus

`ui/OverflowMenu.tsx` is the single owner of the `⋮` actions menu: it composes `ActionMenu` with `ui/OverflowMenuButton.tsx`, so a caller passes the label, actions and `onSelect` once. The glyph is always vertical dots (`ui/overflowMenuIcon.ts`: `"ellipsis-vertical"`); there is no horizontal variant.

- Use `OverflowMenu` for every `ActionMenu` opened by a dots button. `tone` selects the glyph colour and backdrop (`text`, `muted`, `dim`, `filled` for toolbar neighbours on the container surface, `media` for the dark pill over images); `size` selects `touch` (48dp), `regular` (40dp) or `compact` (32dp), and the smaller sizes keep a 48dp target through `controlHitSlop`. `style` positions the menu anchor only.
- Use `OverflowMenuButton` directly only when another owner opens the menu (`MessageActionMenu`, `UsageMenu`, a web sheet). Its `style` is placement only; appearance belongs to `tone`.
- A row whose whole surface opens the menu shows `overflowMenuIcon` as its trailing glyph instead of a literal.
- `accessibilityLabel` is required and names both the trigger and the menu; callers keep their existing labels because tests and accessibility services query them.

Never hand-roll a dots trigger with `Ionicons`. `codewide-v1/overflow-menu-trigger` (in `oxlint-v1-quality.cjs`) rejects `"ellipsis-horizontal"`/`"ellipsis-vertical"` literals outside `overflowMenuIcon.ts`; a non-trigger use of the glyph (a status or placeholder icon) needs a one-line disable with an adjacent `WHY` comment.
