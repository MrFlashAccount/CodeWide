import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const rootGradle = readFileSync(new URL("../android/build.gradle", import.meta.url), "utf8");
const nativeModule = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt", import.meta.url), "utf8");
const nativeVoiceAura = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/rendering/VoiceAuraRenderEffect.kt", import.meta.url), "utf8");
const nativeTransport = readFileSync(new URL("../src/native/native-transport.native.ts", import.meta.url), "utf8");
const voiceAura = readFileSync(new URL("../src/ui/VoiceAura.native.tsx", import.meta.url), "utf8");
const fullscreenModal = readFileSync(new URL("../src/ui/AppFullscreenModal.native.tsx", import.meta.url), "utf8");

describe("native Android voice aura", () => {
  it("requires the RuntimeShader-capable Android baseline", () => {
    expect(rootGradle).toContain("ext.minSdkVersion = 34");
  });

  it("moves the same shader into the Android window used by fullscreen review", () => {
    expect(fullscreenModal).toContain("setNativeVoiceAuraTarget(reactTag)");
    expect(fullscreenModal).toContain("setNativeVoiceAuraTarget(null)");
    expect(fullscreenModal).toContain("collapsable={false}");
    expect(nativeTransport).toContain("export function setNativeVoiceAuraTarget");
    expect(nativeModule).toContain("fun setVoiceAuraTarget(reactTag: Double?)");
    expect(nativeVoiceAura).toContain("fun setTarget(view: View?)");
    expect(nativeVoiceAura).toContain("requestedRootView?.get()");
  });

  it("keeps lifecycle in React and speech levels in the native capture loop", () => {
    expect(voiceAura).not.toContain("useVoiceInputLevel");
    expect(voiceAura).toContain("setNativeVoiceAuraState(active, 0, reducedMotion)");
    expect(nativeModule).toContain("generation == audioCaptureGeneration) voiceAura.setLevel(level)");
    expect(voiceAura).not.toContain("makeImageFromView");
    expect(voiceAura).not.toContain("<ImageShader");
    expect(voiceAura).not.toContain("SkImage");
    expect(nativeModule).toContain("fun setVoiceAuraState(active: Boolean, level: Double, reducedMotion: Boolean)");
    expect(nativeTransport).toContain("export function setNativeVoiceAuraState");
    expect(nativeVoiceAura).toContain('RenderEffect.createRuntimeShaderEffect(runtimeShader, "contents")');
    expect(nativeVoiceAura).toContain('view.setRenderEffect(RenderEffect.createRuntimeShaderEffect(runtimeShader, "contents"))');
    expect(nativeVoiceAura).not.toContain("private var effect: RenderEffect?");
    expect(nativeVoiceAura).toContain("uniform shader contents;");
    expect(nativeVoiceAura).toContain("contents.eval(clamp(samplePoint");
    expect(nativeVoiceAura).not.toContain("makeImageFromView");
    expect(nativeVoiceAura).not.toContain("ImageShader");
  });

  it("accepts the pressed microphone origin in composer and reusable inputs", () => {
    const composer = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));
    const input = compactSource(readFileSync(new URL("../src/ui/Typography.tsx", import.meta.url), "utf8"));
    for (const surface of [composer, input]) {
      expect(surface).toContain("setNativeVoiceAuraOrigin(");
      expect(surface).toContain("findNodeHandle(microphoneButtonRef.current)");
    }
    expect(nativeTransport).toContain("bridge.setVoiceAuraOrigin?.(reactTag)");
    expect(nativeModule).toContain("voiceAura.setOrigin(view)");
    expect(nativeVoiceAura).toContain("source.getLocationOnScreen(location)");
    expect(nativeVoiceAura).toContain("target.getLocationOnScreen(location)");
  });

  it("keeps original Reacticx refraction and brightness on a physical shared front", () => {
    // The shader contract uses one phase for the border and ripple, on both legs.
    expect(nativeVoiceAura).toContain("float front = uIntro * duration - distanceFromOrigin / (1200.0 * uDensity);");
    expect(nativeVoiceAura).toContain("float time = max(0.0, front);");
    expect(nativeVoiceAura).toContain("smoothstep(0.0, 0.08, front)");
    expect(nativeVoiceAura).toContain("12.0 * sin(15.0 * time) * exp(-8.0 * time)");
    expect(nativeVoiceAura).toContain("float2 samplePoint = fragCoord + rippleAmount * uDensity * direction;");
    expect(nativeVoiceAura).toContain("float brightness = 0.3 * (rippleAmount / 12.0) * foreground.a;");
    expect(nativeVoiceAura).toContain("foreground.rgb += half(brightness);");
    expect(nativeVoiceAura).toContain("distanceFromOrigin > 0.001 * uDensity");
    expect(nativeVoiceAura).not.toContain("wavePhase");
    expect(nativeVoiceAura).toContain("float perimeterPosition(");
    expect(nativeVoiceAura).not.toContain("atan(uv.y - 0.5, uv.x - 0.5)");
    expect(nativeVoiceAura).not.toContain("bgMask");
    expect(nativeVoiceAura).toContain('setFloatUniform("uMotion", if (reducedMotion) 0f else 1f)');
  });

  it("retraces the ripple even after a long recording instead of rewinding the recording clock", () => {
    expect(nativeVoiceAura).toContain('setFloatUniform("uIntro", intensity)');
    expect(nativeVoiceAura).toContain("intensity = transition.advance(deltaSeconds)");
    expect(nativeVoiceAura).toContain('setFloatUniform("uOpacity", transition.opacity)');
    expect(nativeVoiceAura).toContain("if (transition.isVisible)");
    expect(nativeVoiceAura).toContain("transition.setActive(active, reduceMotion)");
    expect(nativeVoiceAura).not.toContain("OUTRO_DURATION_NANOS");
    expect(nativeVoiceAura).not.toContain("uRippleTime");
    expect(nativeVoiceAura).not.toContain("uRippleRelease");
    expect(nativeVoiceAura).not.toContain("* uMotion * sin(3.14159265 * uIntro)");
  });
});
