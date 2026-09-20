import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const rootGradle = readFileSync(new URL("../android/build.gradle", import.meta.url), "utf8");
const nativeModule = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt",
    import.meta.url,
  ),
  "utf8",
);
const nativeVoiceAura = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/rendering/VoiceAuraOverlay.kt",
    import.meta.url,
  ),
  "utf8",
);
const nativeTransport = readFileSync(
  new URL("../src/native/native-transport.native.ts", import.meta.url),
  "utf8",
);
const voiceAura = readFileSync(new URL("../src/ui/VoiceAura.native.tsx", import.meta.url), "utf8");
const fullscreenModal = readFileSync(
  new URL("../src/ui/AppFullscreenModal.android.tsx", import.meta.url),
  "utf8",
);
const sheet = readFileSync(new URL("../src/ui/AppSheet.android.tsx", import.meta.url), "utf8");
const targetRegistryUrl = new URL("../src/ui/voiceAuraWindowTarget.ts", import.meta.url);

describe("native Android voice aura", () => {
  it("requires the RuntimeShader-capable Android baseline", () => {
    expect(rootGradle).toContain("ext.minSdkVersion = 34");
  });

  it("owns one touch-through application window without retargeting sheets", () => {
    expect(nativeVoiceAura).toContain(
      "WindowManager.LayoutParams.TYPE_APPLICATION_ATTACHED_DIALOG",
    );
    expect(nativeVoiceAura).not.toContain("WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY");
    expect(nativeVoiceAura).toContain("WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE");
    expect(nativeVoiceAura).toContain("WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE");
    expect(nativeVoiceAura).toContain("WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM");
    expect(nativeVoiceAura).toContain("WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED");
    expect(nativeVoiceAura).toContain("manager.addView(view, createLayoutParams(token))");
    expect(nativeVoiceAura).toContain("manager.removeViewImmediate(view)");
    expect(fullscreenModal).not.toContain("VoiceAuraWindowTarget");
    expect(sheet).not.toContain("VoiceAuraWindowTarget");
    expect(nativeTransport).not.toContain("setNativeVoiceAuraTarget");
    expect(nativeModule).not.toContain("setVoiceAuraTarget");
    expect(existsSync(targetRegistryUrl)).toBe(false);
  });

  it("keeps lifecycle in React and speech levels in the native capture loop", () => {
    expect(voiceAura).not.toContain("useVoiceInputLevel");
    expect(voiceAura).toContain("setNativeVoiceAuraState(active, 0, reducedMotion)");
    expect(nativeModule).toContain(
      "generation == audioCaptureGeneration) voiceAura.setLevel(level)",
    );
    expect(voiceAura).not.toContain("makeImageFromView");
    expect(voiceAura).not.toContain("<ImageShader");
    expect(voiceAura).not.toContain("SkImage");
    expect(nativeModule).toContain(
      "fun setVoiceAuraState(active: Boolean, level: Double, reducedMotion: Boolean)",
    );
    expect(nativeTransport).toContain("export function setNativeVoiceAuraState");
    expect(nativeVoiceAura).toContain("private class VoiceAuraOverlayView");
    expect(nativeVoiceAura).toContain("setBackgroundColor(Color.TRANSPARENT)");
    expect(nativeVoiceAura).toContain(
      "canvas.drawColor(Color.TRANSPARENT, BlendMode.CLEAR)",
    );
    expect(nativeVoiceAura).toContain("if (auraShader == null) return");
    expect(nativeVoiceAura).toContain("override fun isOpaque(): Boolean = false");
    expect(nativeVoiceAura).toContain("paint.shader = shader");
    expect(nativeVoiceAura).toContain(
      "canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)",
    );
    expect(nativeVoiceAura).toContain(
      'RenderEffect.createRuntimeShaderEffect(runtimeShader, "contents")',
    );
    expect(nativeVoiceAura).toContain("if (effectApplied) target?.setRenderEffect(null)");
    expect(nativeVoiceAura).toContain("private val framePacer = VoiceAuraFramePacer()");
    expect(nativeVoiceAura).toContain("reducedMotion || framePacer.shouldDraw(frameTimeNanos)");
    expect(nativeVoiceAura).toContain("if (!reducedMotion)");
    expect(nativeVoiceAura).toContain("private fun configureShaderGeometry");
    expect(nativeVoiceAura).toContain("uniform shader contents;");
    expect(nativeVoiceAura).toContain("contents.eval(clamp(samplePoint");
    expect(nativeVoiceAura).toContain("return mix(contents.eval(fragCoord), foreground");
  });

  it("accepts the pressed microphone origin in composer and reusable inputs", () => {
    const composer = compactSource(
      readFileSync(
        new URL("../src/features/composer/ComposerMicrophone.tsx", import.meta.url),
        "utf8",
      ),
    );
    const input = compactSource(
      readFileSync(new URL("../src/ui/Typography.tsx", import.meta.url), "utf8"),
    );
    for (const surface of [composer, input]) {
      expect(surface).toContain("setNativeVoiceAuraOrigin(");
      expect(surface).toContain("findNodeHandle(microphoneButtonRef.current)");
    }
    expect(nativeTransport).toContain("bridge.setVoiceAuraOrigin?.(reactTag)");
    expect(nativeModule).toContain("voiceAura.setOrigin(view)");
    expect(nativeVoiceAura).toContain("source.getLocationOnScreen(location)");
    expect(nativeVoiceAura).toContain("contentTarget = WeakReference(source.rootView)");
    expect(nativeVoiceAura).toContain("view.getLocationOnScreen(location)");
  });

  it("keeps the launch wave and speech glow on one independent visual surface", () => {
    expect(nativeVoiceAura).toContain(
      "float front = uIntro * duration - distanceFromOrigin / (1200.0 * uDensity);",
    );
    expect(nativeVoiceAura).toContain("float time = max(0.0, front);");
    expect(nativeVoiceAura).toContain(
      "float rippleAmount = 12.0 * sin(15.0 * time) * exp(-8.0 * time);",
    );
    expect(nativeVoiceAura).toContain(
      "float2 samplePoint = fragCoord + rippleAmount * uDensity * direction;",
    );
    expect(nativeVoiceAura).toContain("smoothstep(0.0, 0.08, front)");
    expect(nativeVoiceAura).toContain(
      "float ripple = abs(sin(15.0 * time)) * exp(-8.0 * time) * uMotion;",
    );
    expect(nativeVoiceAura).toContain("float perimeterPosition(");
    expect(nativeVoiceAura).toContain("return half4(half3(glow) * half(alpha), half(alpha));");
    expect(nativeVoiceAura).toContain('setFloatUniform("uMotion", if (reducedMotion) 0f else 1f)');
  });

  it("retraces the ripple even after a long recording instead of rewinding the recording clock", () => {
    expect(nativeVoiceAura).toContain('setFloatUniform("uIntro", intensity)');
    expect(nativeVoiceAura).toContain("intensity = transition.advance(deltaSeconds)");
    expect(nativeVoiceAura).toContain('setFloatUniform("uOpacity", transition.opacity)');
    expect(nativeVoiceAura).toContain("if (transition.isVisible)");
    expect(nativeVoiceAura).toContain("transition.setActive(active, reduceMotion)");
    expect(nativeVoiceAura).toContain("mainHandler.removeCallbacks(forceClose)");
    expect(nativeVoiceAura).toContain(
      "mainHandler.postDelayed(forceClose, CLOSE_FALLBACK_MILLIS)",
    );
    expect(nativeVoiceAura).toContain(
      "VoiceAuraTransition.CLOSE_DURATION_MILLIS + ONE_FRAME_MILLIS",
    );
    expect(nativeVoiceAura).not.toContain("CLOSE_FALLBACK_MILLIS = 900L");
    expect(nativeVoiceAura).toContain("if (!requestedActive)");
    expect(nativeVoiceAura).toContain("transition.reset()");
    expect(nativeVoiceAura).not.toContain("OUTRO_DURATION_NANOS");
    expect(nativeVoiceAura).not.toContain("uRippleTime");
    expect(nativeVoiceAura).not.toContain("uRippleRelease");
    expect(nativeVoiceAura).not.toContain("* uMotion * sin(3.14159265 * uIntro)");
  });
});
