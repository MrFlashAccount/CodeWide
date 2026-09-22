# Android window density synchronization

CodeWide owns one React surface in MainActivity. Its window resource density must agree
with RN's process-global PixelUtil conversions. This is an application compatibility
boundary, not a React Native dependency patch or a Samsung-specific font/layout offset.

Device evidence: the SM-F966B / Android 16 report from CodeWide 0.2.182 showed window,
surface and JS density 2.00625 (321 dpi) in pop-up mode while RN screen density remained
2.3375 (374 dpi), including after initDisplayMetrics(Activity) and the completed layout.
At full screen all densities agreed. The report establishes the mismatch; visual
correction on the device remains to be verified with the changed APK.

WindowDisplayMetrics preserves physical screen pixel bounds but takes conversion fields
from the surface's Resources. Window metrics retain their live resource reference;
screen metrics are a separate snapshot, so no Android Resources are modified. This
follows the application-level strategy in [Jitsi PR 17844](https://github.com/jitsi/jitsi-meet/pull/17844).

MainActivity discovers its ReactRootView after content installation, including Expo's
optional container. SurfaceDisplayMetrics synchronizes before first measure, on attach,
resume and configuration changes. Its global-layout listener is registered after RN's
attachment listener so rotation-induced metric resets are corrected. It requests a new
layout only when the published metrics differ, removes its observer on detach, reattaches
with the view, and releases the view on Activity destruction. Pausing a visible window
does not disable the correction. Diagnostic recording remains independent.

The global RN holder still cannot represent simultaneous React surfaces at different
densities. CodeWide's single-Activity/surface boundary makes this workaround applicable;
introducing another React display requires revisiting that assumption. A dependency
patch is a fallback if this lifecycle strategy fails. A per-surface conversion redesign
could remove the global limitation but affects RN Java/C++ and native libraries; its
cheapest useful experiment would be a two-density surface reproducer in an isolated RN
checkout, not an app-wide UI rewrite.

Validation: JVM tests cover the reported 321/374 dpi mismatch through PixelUtil,
physical-screen bounds, initial setup, return to fullscreen, font-only changes,
late RN writes, convergence, detach/reattach and disposal. Device acceptance still needs
cold launch in pop-up, fullscreen/pop-up transitions, repeated resize, rotation,
fold/unfold, background/resume, keyboard and modal opening. Check text and icon clipping
and the diagnostic report together; matching numbers alone do not prove visual recovery.
