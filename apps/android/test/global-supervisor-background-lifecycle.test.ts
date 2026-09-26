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
    const applicationSource = readFileSync(
      new URL("../android/app/src/main/java/dev/codewide/app/MainApplication.kt", import.meta.url),
      "utf8",
    );
    const levelOwnerSource = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/remote/GlobalVoiceAudioLevelOwner.kt",
        import.meta.url,
      ),
      "utf8",
    );
    const captureHealthSource = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/remote/GlobalVoiceCaptureHealthOwner.kt",
        import.meta.url,
      ),
      "utf8",
    );
    const wakeLockOwnerSource = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/remote/GlobalVoiceWakeLockOwner.kt",
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
    expect(bridgeSource).toContain("CodeWideGlobalVoiceOverlayMicrophoneToggle");
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
    expect(applicationSource).toContain(".setSamplesReadyCallback { samples ->");
    expect(applicationSource).toContain(".setAudioRecordErrorCallback(");
    expect(applicationSource).toContain(".setAudioRecordStateCallback(");
    expect(applicationSource).toContain("VoiceCaptureForegroundService.acceptWebRtcInputSamples(");
    expect(serviceSource).toContain("GlobalVoiceAudioLevelOwner(");
    expect(serviceSource).toContain("fun acceptWebRtcInputSamples(");
    expect(serviceSource).toContain("fun updatePlaybackLevel(level: Double)");
    expect(levelOwnerSource).toContain("if (!active) return");
    expect(levelOwnerSource).not.toContain("AppState");
    expect(captureHealthSource).toContain("class GlobalVoiceCaptureHealthOwner");
    expect(captureHealthSource).toContain("GlobalVoiceCaptureHealthEventKind.INTERRUPTED");
    expect(serviceSource).toContain("Intent.ACTION_SCREEN_OFF");
    expect(serviceSource).toContain("GlobalVoiceForegroundModule.requestCaptureRecovery()\n");
    expect(manifest).toContain("android.permission.WAKE_LOCK");
    expect(serviceSource).toContain("wakeLockOwner.setActivationActive(hasOverlay)");
    expect(serviceSource).toContain("wakeLockOwner.release()\n");
    expect(wakeLockOwnerSource).toContain("PowerManager.PARTIAL_WAKE_LOCK");
    expect(wakeLockOwnerSource).toContain('"CodeWide:GlobalVoice"');
    expect(wakeLockOwnerSource).toContain("MAX_HOLD_MS");
    expect(serviceSource).toContain("wakeLockHeld=");
    const microphoneUpdate = serviceSource.slice(
      serviceSource.indexOf("fun updateMicrophoneMuted"),
      serviceSource.indexOf("fun acquire(", serviceSource.indexOf("fun updateMicrophoneMuted")),
    );
    expect(microphoneUpdate).not.toContain("wakeLockOwner");
    expect(serviceSource).not.toContain("ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS");
    expect(webRtcSessionSource).toContain("setInterval(");
    expect(webRtcSessionSource).toContain("peer.getStats()");
    expect(webRtcSessionSource).toContain("options.options.onPlaybackLevel(");
    expect(webRtcSessionSource).not.toContain("peer.getStats(audioTrack)");
    expect(webRtcSessionSource).toContain(
      'publishTerminal(owner, onTerminal, "disconnectedTimeout")',
    );
    expect(webRtcSessionSource).toContain('"CodeWideGlobalVoiceCaptureInterrupted"');
    expect(overlaySource).toContain("OverlayGestureThreshold");
    expect(overlaySource).toContain("OverlayReleasePlacement.Free");
    expect(overlaySource).toContain("OverlaySnapTrajectory");
    expect(overlaySource).toContain("startLaunchHandoff");
    expect(overlaySource.indexOf("view.startLaunchHandoff(origin.diameter)")).toBeLessThan(
      overlaySource.indexOf("windowManager.addView(view, params)"),
    );
    // Native menu gesture, labels, window bounds and disposal contracts run in Robolectric.
    // This cross-owner check only verifies that the service composes the menu owner.
    expect(overlaySource).toContain("VoiceOverlayControls(");
    expect(orbSlotSource).toContain("VoiceAssistantOrbRendererFactory.create(context, style)");
    expect(orbSlotSource).toContain("setLayerType(View.LAYER_TYPE_HARDWARE, MUTED_LAYER_PAINT)");
    expect(orbSlotSource.indexOf("removeView(previous)")).toBeLessThan(
      orbSlotSource.indexOf("renderer = createRenderer(style)"),
    );
    expect(orbViewSource).toContain("abstract class VoiceAssistantOrbView");
    expect(orbViewSource).toContain("override fun onDetachedFromWindow()");
    expect(orbViewSource).toContain("cancelFrame()");
    expect(orbViewSource).toContain(
      "if (framePosted || !attached || reducedMotion || !usesMainThreadAnimationClock) return",
    );
    expect(orbViewSource).toContain('DISABLED("disabled")');
    const particlesSource = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/rendering/ParticlesOrbView.kt",
        import.meta.url,
      ),
      "utf8",
    );
    expect(particlesSource).toContain("override val usesMainThreadAnimationClock = false");
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
    // Settling/remapping behavior is covered by the native layout-owner tests.
    expect(overlaySource).toContain("layoutSettler.observe(layout)");
    expect(overlaySource).toContain("layoutSettler.commit(layout)");
    expect(overlaySource).not.toContain("layoutParams as WindowManager.LayoutParams");
  });
});
