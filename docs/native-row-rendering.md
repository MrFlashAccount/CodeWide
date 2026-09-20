# Native row rendering boundary

LegendList continues to own virtualization and scrolling. Changing a row's
renderer must not replace the list, add another scrolling surface, or remove
the fixed-height contract used by its virtual cells.

## Row ownership

- Display-only `AppListRow` icon descriptors use the RN row and the bundled
  Ionicons font. The glyph is available synchronously, so a missing or delayed
  XML painter cannot leave a permanent empty slot. Icon-free rows and
  `trailingBusy` may still use one Compose Host.
- Custom `leading`, `descriptionLeading`, or `trailing` React content sends the
  entire row to `AppListRowContent`. Do not embed those accessories back into a
  Compose ListItem through RNHostView.
- Custom secondary controls and the primary action have separate accessible
  targets. A Pin, Exclude, Switch, or menu action must not activate the row.
- Descriptor and custom variants of the same accessory are mutually exclusive.
- Virtualized cell reuse must update the icon, text and action without changing
  the row's fixed geometry.

## Audited consumers

| Surface | Ownership |
| --- | --- |
| Attachments | LegendList with a fixed-height RN row and synchronous Ionicons |
| Project/server selection and simple settings rows | RN display descriptors |
| Project rows with a separate Pin button | Entire row RN |
| Port rows with service badges, Exclude or action menus | Entire row RN |
| Server settings with emoji, animated status or switches | Entire row RN |
| Chat control options and search-filter pins | RN display descriptors |
| Legacy and V2 menu items | Named glyphs/checkmarks use RN Ionicons; image sources use Expo Icon |

The descriptor name catalog is bounded and platform-neutral. New list
descriptors must use a catalog name, but Android list rows render that name
through RN Ionicons. Menus use the same reliable font-backed path and do not
depend on asynchronously loaded XML painters.

Whole-sheet/dialog/fullscreen content and popup anchors still need RNHostView
at their ownership boundary. These are not redundant per-accessory bridges.

## Verification

Adapter tests cover fixed geometry, synchronous icon rendering, recycled
actions, selection/loading transitions and independent primary/secondary actions.
The V2 quality gate also checks the shared icon owner and both menu consumers.

These checks do not prove frame-time improvements. Before promoting a device
build, compare opening and long scrolling in Attachments, Manage Projects,
Add Project, Ports and Settings; check menu alignment, large font scaling and
TalkBack access to both primary and secondary actions.
