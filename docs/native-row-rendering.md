# Native row rendering boundary

LegendList continues to own virtualization and scrolling. Changing a row's
renderer must not replace the list, add another scrolling surface, or remove
the fixed-height contract used by its virtual cells.

## Row ownership

- Display-only `AppListRow` accessories use `leadingIcon`, `descriptionIcon`,
  `trailingIcon`, or `trailingBusy`. Android renders one Compose Host containing
  the ListItem, text, native icons and progress indicator.
- Custom `leading`, `descriptionLeading`, or `trailing` React content sends the
  entire row to `AppListRowContent`. Do not embed those accessories back into a
  Compose ListItem through RNHostView.
- Custom secondary controls and the primary action have separate accessible
  targets. A Pin, Exclude, Switch, or menu action must not activate the row.
- Descriptor and custom variants of the same accessory are mutually exclusive.
- Native icon bounds are reserved before Expo's asynchronous painter loads.
  Virtualized cell reuse must update the icon, text and action without changing
  the reserved geometry.

## Audited consumers

| Surface | Ownership |
| --- | --- |
| Attachments | LegendList with Compose-only row content |
| Project/server selection and simple settings rows | Native display descriptors |
| Project rows with a separate Pin button | Entire row RN |
| Port rows with service badges, Exclude or action menus | Entire row RN |
| Server settings with emoji, animated status or switches | Entire row RN |
| Chat control options and search-filter pins | Native display descriptors |
| Legacy and V2 menu items | Named glyphs/checkmarks use RN Ionicons; image sources use Expo Icon |

The named native catalog is bounded. Its type/guard module is platform-neutral;
only native consumers load XML assets. New list descriptors must use a catalog
name. Menu icon migration was rolled back independently: menus retain their
RN Ionicons renderer and do not consult this catalog.

Whole-sheet/dialog/fullscreen content and popup anchors still need RNHostView
at their ownership boundary. These are not redundant per-accessory bridges.

## Verification

Adapter tests cover fixed geometry, delayed icon painting, recycled actions,
selection/loading transitions and independent primary/secondary actions.
The V2 quality gate also checks the shared icon owner and both menu consumers.

These checks do not prove frame-time improvements. Before promoting a device
build, compare opening and long scrolling in Attachments, Manage Projects,
Add Project, Ports and Settings; check menu alignment, large font scaling and
TalkBack access to both primary and secondary actions.
