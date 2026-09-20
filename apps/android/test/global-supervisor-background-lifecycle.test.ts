import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Global Voice background lifecycle", () => {
  it("registers one shared microphone foreground service and a dedicated Global Voice bridge", () => {
    const manifest = readFileSync(
      new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
      "utf8",
    );
    const packageSource = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/remote/CodeWidePackage.kt",
        import.meta.url,
      ),
      "utf8",
    );
    const bridgeSource = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/remote/GlobalVoiceForegroundModule.kt",
        import.meta.url,
      ),
      "utf8",
    );
    const serviceSource = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/remote/VoiceCaptureForegroundService.kt",
        import.meta.url,
      ),
      "utf8",
    );
    const webRtcSessionSource = readFileSync(
      new URL("../src/native/globalSupervisorWebRtcSession.native.ts", import.meta.url),
      "utf8",
    );
    const overlaySource = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/remote/GlobalVoiceOverlayController.kt",
        import.meta.url,
      ),
      "utf8",
    );
    const orbViewSource = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/rendering/VoiceAssistantOrbView.kt",
        import.meta.url,
      ),
      "utf8",
    );
    const orbSlotSource = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/rendering/VoiceAssistantOrbSlotView.kt",
        import.meta.url,
      ),
      "utf8",
    );

    expect(manifest).toContain(
      'android:name="dev.codewide.app.remote.VoiceCaptureForegroundService"',
    );
    expect(manifest).toContain('android:foregroundServiceType="microphone"');
    expect(packageSource).toContain("GlobalVoiceForegroundModule(reactContext)");
    expect(manifest).toContain("android.permission.SYSTEM_ALERT_WINDOW");
    expect(packageSource).toContain("NebulaOrbManager()");
    expect(bridgeSource).toContain(
      "VoiceCaptureForegroundService.acquire(context, token, overlay = true)",
    );
    expect(bridgeSource).toContain("VoiceCaptureForegroundService.release(token)");
    expect(bridgeSource).toContain("Settings.ACTION_MANAGE_OVERLAY_PERMISSION");
    expect(bridgeSource).toContain("CodeWideGlobalVoiceOverlayStop");
    expect(bridgeSource).toContain("VoiceAssistantOrbStyle.fromWireValue(style)");
    expect(bridgeSource).toContain("VoiceAssistantOrbState.fromWireValue(state)");
    expect(bridgeSource).toContain("fun setOrbLaunchOrigin(");
    expect(bridgeSource).toContain("fun clearOrbLaunchOrigin(");
    expect(bridgeSource).toContain("visibleOrbReturnTarget");
    expect(bridgeSource).toContain(
      "VoiceCaptureForegroundService.release(token) { promise.resolve(null) }",
    );
    expect(serviceSource).toContain(
      "globalVoiceOverlay.hide(GlobalVoiceForegroundModule.visibleOrbReturnTarget())",
    );
    expect(serviceSource).toContain("fun updateOrbLevel(level: Double)");
    expect(webRtcSessionSource).toContain("setInterval(");
    expect(webRtcSessionSource).toContain("peer.getStats(audioTrack)");
    expect(webRtcSessionSource).toContain("options.options.onLevel(");
    expect(overlaySource).toContain("OverlayGestureThreshold");
    expect(overlaySource).toContain("OverlayReleasePlacement.Free");
    expect(overlaySource).toContain("OverlaySnapTrajectory");
    expect(overlaySource).toContain("startLaunchHandoff");
    expect(overlaySource.indexOf("view.startLaunchHandoff(origin.diameter)")).toBeLessThan(
      overlaySource.indexOf("windowManager.addView(view, params)"),
    );
    expect(overlaySource).toContain("VoiceOverlayIconButton");
    expect(overlaySource).toContain('"Stop Voice Assistant"');
    expect(overlaySource).toContain('"More Voice Assistant controls"');
    expect(overlaySource).toContain("FLAG_WATCH_OUTSIDE_TOUCH");
    expect(overlaySource).not.toContain("TextView");
    expect(orbSlotSource).toContain("VoiceAssistantOrbRendererFactory.create(context, style)");
    expect(orbSlotSource.indexOf("removeView(previous)")).toBeLessThan(
      orbSlotSource.indexOf("renderer = createRenderer(style)"),
    );
    expect(orbViewSource).toContain("abstract class VoiceAssistantOrbView");
    expect(orbViewSource).toContain("override fun onDetachedFromWindow()");
    expect(orbViewSource).toContain("cancelFrame()");
    expect(orbViewSource).toContain("if (framePosted || !attached || reducedMotion) return");
    expect(orbViewSource).toContain('DISABLED("disabled")');
    const nebulaSource = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/rendering/NebulaOrbView.kt",
        import.meta.url,
      ),
      "utf8",
    );
    expect(nebulaSource).toContain("override fun onOrbStateChanged()");
    expect(nebulaSource).toContain("orbState == VoiceAssistantOrbState.DISABLED");
    expect(overlaySource).toContain("GlobalVoiceOverlayPlacement.drag(");
    expect(overlaySource).toContain("OverlayMotionCorridor.containing(");
    expect(overlaySource).toContain("motion.view.setMotionPosition(");
    expect(overlaySource).not.toContain("onFrame = { point -> moveExactly(params, point) }");
    expect(overlaySource).toContain("view.setWindowPosition(");
    expect(overlaySource).toContain("safeBoundsTracker?.update(bounds) == true");
    expect(overlaySource).not.toContain("layoutParams as WindowManager.LayoutParams");
    expect(overlaySource).toContain("WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH");
    expect(overlaySource).toContain("VoiceOverlayIconButton");
    expect(overlaySource).not.toContain("TextView");
  });
});
