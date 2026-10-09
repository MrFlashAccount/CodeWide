# Desktop input

`DesktopInputSurface` is the public, opt-in controller attached to one browser view.
It owns profiles and semantic modifier/drag/precision state through `DesktopInputModel`.
The native target owns pointer coordinates, touch interpretation and Android event delivery.
Controls remain available without the soft keyboard; they do not steal the editor's focus.

General, DevTools and Perfetto profiles are local predefined bindings. They contain no scripts,
URLs, page content or credentials. A layout editor, persistence, terminal adapter and system-wide
input are outside this first stage. The native target never uses CDP, Accessibility, Shizuku,
global input injection or another process. Each host may contain exactly one WebView.

Inactive surfaces, renderer replacement, detachment and target/window-focus loss release held input.
Normal touch and physical-device input pass through while emulation is disabled. Older native
shells and web do not advertise the unsupported Android controls.

Native event sequencing and semantic lifecycle need automated checks. Actual WebView hover,
context menus, canvas selection, keyboard focus and device/firmware behavior require separate
physical-device validation; source and compilation are not evidence of those interactions.

Android's public SDK cannot populate `MotionEvent.actionButton`, which Chromium requires for
DOM mouse button transitions. `DesktopMouseEventButtons` isolates a reflective compatibility
shim for AOSP's currently `unsupported` (non-SDK) setter. Lookup and invocation are probed before
controls are advertised; firmware denial disables the feature. This is a compatibility risk,
not a promise across Android/WebView versions. No hidden-API exemption or global injection is used.
Source references: [Chromium EventForwarder](https://chromium.googlesource.com/chromium/src/+/main/ui/android/java/src/org/chromium/ui/base/EventForwarder.java),
[AOSP MotionEvent](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/view/MotionEvent.java),
[AOSP hidden API flags](https://android.googlesource.com/platform/prebuilts/runtime/+/refs/heads/main/appcompat/hiddenapi-flags.csv).

Use `Mouse` separately below the page or inspector. One finger moves a relative cursor,
a tap clicks, a stationary hold drags, two fingers scroll, and two/three-finger taps click
right/middle. The panel can latch modifiers and the left button; `Release` clears them.
Profile switching resets held input. Controls disarm during page loading or feedback selection.
The first stage requires a new native APK; an OTA delivered to an older APK keeps normal touch
and hides the unavailable controls. The first-stage APK was published as 0.2.222 (versionCode 235, runtime 0.2.222-native-235).
Physical-device validation remains unverified.
