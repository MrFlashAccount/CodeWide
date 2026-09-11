# Legend List 3.3.5: immediate native resize follow

Adapted from [upstream PR #507](https://github.com/LegendApp/legend-list/pull/507),
head `28112f1b1c4ffc96c97e2f496da2cc58435802d0` (not merged when adopted).

Scope: the React Native CommonJS and ESM bundles. Web/React DOM bundles are
unchanged; they have different measurement and anchoring behavior.

When `maintainScrollAtEnd.onItemLayout` is enabled and the reader is at the end,
row resizing issues a nonanimated follow without waiting for another animation
frame. Changes larger than the existing native measurement-noise epsilon qualify,
instead of only changes larger than 5 px. Data-change follow retains its original
scheduler and configured animation.

Unlike the older PR base, 3.3.5 also follows first measurements. Preserve that,
the native MVCP adjustment barrier, the user-scroll cancellation guard, and
anchored end-space updates. No application scroll policy or native anchor
implementation is replaced.

Regression command:

```sh
pnpm exec vitest run apps/android/test/legend-list-resize-follow.test.ts
```

The suite executes the installed native core functions against measurement,
scroll-command and scheduler ports. Before patching, 10 of 20 cases fail.
These tests prove JS scheduling behavior, not absence of all native frame jumps.
Pending native MVCP adjustment and an already scheduled/active follow can still
defer a resize follow. Verify visual behavior during streaming and accordion
expansion on device before claiming complete resolution.

On upgrading Legend List, review/remove this patch against the upstream fix;
do not mechanically retain it across versions.
