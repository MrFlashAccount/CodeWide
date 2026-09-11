# V1 presentation contract

V1 owns its tokens in `apps/android/src/theme.ts`. The typography roles follow
the V2 scale, without importing V2 runtime or theme modules. Existing V1 screens
keep their navigation and data loading; this migration changes presentation only.

## Sheets

Sliding sheets have one title owner and no close-icon button. The drag handle
is a labelled dismiss control; swipe, native Back and the scrim retain their
existing dismissal policy. Busy flows disable all dismissal paths together.
The shell owns horizontal content insets; expanded scroll content owns its
bottom padding without an additional frame/surface inset.
Ports and Attachments have no manual refresh button or pull-down gesture;
their resource owners load and update the displayed data automatically.
Fullscreen editors and destructive/cancellation controls are not
sheet dismissal controls and retain their existing actions.

## Typography

| Role | Size / line height | Use |
| --- | --- | --- |
| heading | 22 / 28 | Sheet titles and primary headings |
| title | 16 / 22 | Screen titles and secondary headings |
| body | 14 / 20 | Messages, ordinary text and inputs |
| label | 12 / 16 | Supporting labels and activity headers |
| caption | 10 / 14 | Times, counters and compact metadata |
| code | 13 / 20 | Inline technical text and diagnostics |
| composerInput | 15 / 21 | Composer input and its height calculation |
| voiceLabel | 13 / 20 | Recording controls |
| emoji | 22 / 28 | Standalone emoji |

Use a complete role rather than independently choosing size and line height.
Use `typeWeight.regular`, `medium` or `semibold` for emphasis. These correspond
to the three bundled Roboto Flex font files. Custom renderer fonts remain owned
by their renderer.

## Spacing and alignment

Use `spacing` for gaps and insets. The main scale is 4, 8, 12, 16, 24, 32;
2 is optical spacing, 6 is compact-row spacing and 10 is an input inset.
Use `iconSize` for glyphs independently of the surrounding touch target.
Use `controlSize` for recurring control geometry, and `radii` for shared shapes.

Text-adjacent icons in the conversation use `InlineIcon` with the neighboring
text role (`caption`, `label`, `body`, `title`). Glyph size follows that role's
font size; its centered slot follows the line height. Both use the same capped
accessibility multiplier as text, including smaller-font settings. `InlineEmoji`
gives thread-title emoji the same predictable slot. Icon-only toolbar actions
retain the independent `iconSize` scale and their existing touch targets.

The conversation header, timeline and composer share a 16dp outer inset.
Message content and metadata share a 12dp inner inset. Activity rows share one
icon/text grid, without a second indentation for nested disclosure cards.

Buttons have three sizes: compact 32, regular 40, primary/touch 48dp. Icon-only
buttons use square bounds; text buttons use minimum height and content-driven
width so labels can grow with accessibility scaling. Never clamp chip text to
an arbitrary pixel width. Use `controlHitSlop` for isolated compact buttons;
hit slop cannot extend beyond the parent, so dense controls still need adequate
parent bounds and separation.

Panels and lists are not buttons: `layoutSize` owns headers (56), rows (64) and
metadata rows (24). Rounded shapes use 4/8/16/24dp; `pill` is circular and the
30dp menu radius preserves the external native/HeroUI menu-shape contract.

Prefer centered row containers over negative margins or translated icons.
An inset that clears a neighboring control must be derived from that control's
size and the row gap, not a second unrelated number. Zero spacing and measured
insets are valid; viewport, canvas and renderer dimensions are not spacing tokens.

`ui/thread-list-layout.ts` owns fixed sidebar cell geometry. Tests ensure two
text lines and section headers fit at the maximum supported font multiplier.
The composer measurement uses the same line-height token as its input.
The action rail allows its single-line localized timestamp to determine width.

## Renderer boundary

The native code renderer has a fixed 11/16 grid. Its plain-text fallback uses the
same named constants from `rendering/native-code-block.ts`; changing it to the
app's 13/20 code role without changing native measurement would clip content.
Terminal, editor, Mermaid and drawing canvas internals retain their own geometry.
Their surrounding application controls use the presentation tokens.

## Guardrails

`codewide/presentation-tokens` rejects literal text sizes, line heights, weights,
tracking, radii and nonzero spacing in V1 styles and inline JSX styles, plus raw
heights in named button/control styles. It permits
tokens, explicit renderer constants, zero resets and measured dimensions.

Run `pnpm --filter @codewide/android typecheck`,
`pnpm --filter @codewide/android lint` and
`pnpm exec vitest run apps/android/test` after changing this contract.
