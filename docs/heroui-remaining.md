# HeroUI after the V1 Compose popover migration

Scope: Android V1, updated 2026-09-07. This is a source inventory, not a device-parity certification. V2 is not migrated by this change.

## Migrated

- Accounts / Manage Projects / Archived threads menu: `CodeWideScreen.ThreadListMenu` → `ui/UsagePopover` → `ui/AppPopover.android`.
- Context-window popover: the same `ui/UsagePopover` with conversation data.
- Per-bubble cost breakdown: `ui/CostBreakdownPopover` → `ui/AppPopover.android`.

Compose owns the popup window, anchor, rounded surface and vertical scrolling. Existing React Native content is hosted through `RNHostView`; calculations, animated numbers, SVG charts, account refresh and expansion state remain in their existing owners. There is no inner RN ScrollView or pointer triangle. Compose chooses placement according to available space; the non-Android placement props are not promises of forced Android placement.

The popup anchor stays mounted while opening and closing. Popup bodies are only mounted while open. The width remains bounded by the current window.

## Native shape root cause

The dependency patch exposed `cornerRadius` and used `RoundedCornerShape` in Kotlin, but Expo autolinking selected the published prebuilt `expo-ui` AAR. The patched source was therefore not compiled. Android autolinking now sets `buildFromSource: ["expo-ui"]` (the Gradle project name, not the npm package name).

Both migrated popovers and the V1 action menu use `radii.selected`, the bubble radius. Source compilation activates all existing Expo UI Kotlin patches, including RNHostView touch routing and sheet behavior; native compilation must remain a release gate. OTA alone cannot change the AAR already embedded in an APK.

## Remaining direct HeroUI dependencies

V1 list rows now use `ui/AppListRow`: Compose `ListItem` on Android, with the same typography as the skills picker. This covers attachment resources, ports, project management and selection, model/thinking/personality/access selections, thread/search filters, server/account settings and ordinary settings actions. LegendList retains virtualization; attachments and ports share the explicit 72 dp two-line row height. Group corners and separators do not add to virtual-cell height. Background terminal command/path text remains selectable React Native content with shared row styles; the metadata/action row uses Compose. Compact attachment cards, editing forms, data ownership and transport are unchanged.

There are no remaining `ListGroup` references in `apps/android/src`. This does not mean HeroUI itself has been removed.

| Area | Current owners | Replacement possibility / constraint |
| --- | --- | --- |
| Live plan popover | `ui/LiveTurnPlanPopover.tsx` | Same Compose shell is a candidate. Preserve scroll and step state; not included in these three windows. |
| Goal editor | `CodeWideScreen.tsx`: Dialog, Accordion, Button, TextField, Label, FieldError | Compose BasicAlertDialog can host the existing body. A full content rewrite must preserve voice input, validation, keyboard and async actions. |
| Confirmation dialogs | `ui/AppDialogSurface.native.tsx` | Compose AlertDialog / BasicAlertDialog available. Blur treatment and button variants are not automatic visual equivalents. |
| Project picker / manager controls | `ui/ProjectPickerSheet.tsx`: Accordion, Button, SearchField | Rows use Compose ListItem. Disclosure groups, pin buttons and search controls remain; no exported one-to-one Accordion component in installed Expo UI 57.0.9. |
| Toasts | `ui/HeroUIRoot.native.tsx`, `rendering/DocumentPreviewHost.tsx` | Snackbar exists, but queueing, swiping, actions and native-window placement need an app-owned policy. Not a drop-in import replacement. |
| Portal hosts | `ui/AppSheet.android.tsx`, `ui/AppFullscreenModal.android.tsx`, `ui/HeroUIRoot.native.tsx` and platform fallbacks | These host RN overlays within different native windows. Removing them before migrating their consumers risks invisible overlays. A native popup is not a generic replacement for an RN portal registry. |
| Root provider | `ui/HeroUIRoot.native.tsx` | Keep until dependent components, toast and portal consumers are gone. Uniwind styling is a separate dependency. |
| Parallel presentation implementation | `presentation/usage/UsagePopoverView.android.tsx` | Still HeroUI; not the V1 CodeWideScreen owner changed here. |
| V2 | `v2/presentation/usage/{UsagePopoverView,CostBreakdownPopover,LiveTurnPlanPopover}.android.tsx`, `v2/ui/AppDialogSurface.tsx` | Separate migration and validation scope. These imports remain. |
| Web / non-Android fallbacks | `ui/AppPopover.tsx`, root and modal fallbacks | Intentionally retain HeroUI where Compose is unavailable. |

No evidence establishes that any remaining feature is fundamentally impossible without HeroUI. However, Accordion, generic RN portals and the current toast behavior lack a direct one-to-one Expo component. Replacing those needs composition and lifecycle work, not just swapping JSX names.

## Settings scroll investigation

The version footer used `Text selectable`. Android `TextView.setTextIsSelectable(true)` enables focus-in-touch-mode. React Native `ReactScrollView.requestChildFocus` explicitly scrolls to the focused descendant; platform ScrollView also preserves visibility of a focused descendant on size changes. This is a concrete route by which sheet resizing and the periodically updating diagnostics above the footer can pull scrolling toward Version.

The footer is now nonselectable and explicitly copyable by long press / accessibility action. Other settings fields keep their focus and keyboard scrolling. No global focus suppression, scroll reset, or timer-based scroll correction was added. Node rendering tests prove copy behavior and the absence of the selectable footer; they do not reproduce Samsung sheet gestures. Physical confirmation of the reported jumping remains outstanding.
