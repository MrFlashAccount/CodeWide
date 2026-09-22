# Android floating-window regressions

## Scope and cause

The last three composer chips (Changes, Attachments, Ports) share `AnimatedNumber`.
Its transparent `AppText` measured with the current window metrics, while its native
painter cached pixels from process-global screen metrics only during a React prop
transaction. A density change with the same count could leave the painter larger
than its measured container. Ordinary labels in the model and permissions chips
used the normal RN text path.

`AnimatedNumberView` now derives text pixels from its own window resources at draw
time without resetting the numeric animation. Measurement and drawing share the
accessibility scaling cap and tabular digits. Regression tests compare an existing
counter against a fresh counter after repeated density changes with unchanged props,
including a transient incorrect screen density and a font-scale change.

Freeform windows on Android 15 can deliver IME insets without any keyboard animation
callbacks. Keyboard Controller 1.21.9 only handled such insets for resizing an already
visible keyboard. Its initial show/hide state therefore never reached the sticky
composer or keyboard-aware timeline.

The persisted dependency patch reconciles current window overlap on the next frame
when no prepared/running/interactive animation owns the transition. It publishes the
normal start/move/end and will/did events, deduplicates unchanged insets, coalesces
rapid changes, and cancels pending work on destruction. Suspended callbacks cannot
publish. Existing animation start staging remains intact.

Gradle autolinking now fingerprints the workspace pnpm lockfile: a patch changes the
native dependency's resolved path even when the Android package.json is unchanged.
Otherwise incremental builds can silently keep compiling the old library.

## Automated validation

```sh
pnpm validate:android:v1
pnpm --filter @codewide/android compile:android
sh scripts/android-gradle.sh :app:testDebugUnitTest
```

Focused native regressions: `AnimatedNumberResizeTest` and
`KeyboardInsetsReconciliationTest`. The latter exercises the installed library's
actual callback lifecycle and event payloads, replacing only JNI/JS delivery in
Robolectric. It covers show, resize, hide, duplicate insets, rapid reversal,
suspension, destruction, and normal animated transitions.

`v1-animated-number.render.test.tsx` checks the JS/native typography contract for all
three labels. Before the fixes, retained-counter bitmap comparisons failed and a
show without animation callbacks emitted no transition events.

## Emulator evidence and remaining handset checks

Android 15 / API 35 freeform, 1080x2400, density 420: reproduced keyboard overlap
using an isolated `KeyboardProvider` / `KeyboardStickyView` / TextInput fixture in
the real debug APK. Before the patch RN emitted keyboardDidShow but the composer
stayed covered. After the patch it moved above the IME. Resizing the window while
the keyboard remained visible changed overlap from 97.14dp to 184dp and preserved
the composer immediately above the IME. Hiding the keyboard restored the composer
to the bottom of the resized window. A fresh fullscreen launch also kept the
composer above the IME.

This does not prove Samsung popup-window behavior or font scaling on the affected
phone. Before marking the handset scenario verified:

1. Open a thread in a phone popup window. Keep resource counts unchanged and resize
   repeatedly in both directions. Compare the final three chip labels with model
   and permissions labels; scroll the chip strip to inspect each full label.
2. Repeat with increased system font size, and move between fullscreen and popup.
3. Show/hide the keyboard repeatedly; resize and move the window with it open.
   Check composer position and the last timeline row, without a double bottom gap.
4. Repeat with normal animations and reduced motion. Check keyboard switching and
   opening/closing a sheet while the keyboard is visible.

These Kotlin and dependency changes require an APK; an OTA alone cannot carry them.
