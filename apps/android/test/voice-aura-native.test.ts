import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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

  it("applies the original shader to the live Android view tree", () => {
    expect(voiceAura).toContain("useVoiceInputLevel(controller, active ? scope : null)");
    expect(voiceAura).toContain("setNativeVoiceAuraState(active, level, reducedMotion)");
    expect(voiceAura).not.toContain("makeImageFromView");
    expect(voiceAura).not.toContain("<ImageShader");
    expect(voiceAura).not.toContain("SkImage");
    expect(nativeModule).toContain("fun setVoiceAuraState(active: Boolean, level: Double, reducedMotion: Boolean)");
    expect(nativeTransport).toContain("export function setNativeVoiceAuraState");
    expect(nativeVoiceAura).toContain('RenderEffect.createRuntimeShaderEffect(runtimeShader, "contents")');
    expect(nativeVoiceAura).toContain('view.setRenderEffect(RenderEffect.createRuntimeShaderEffect(runtimeShader, "contents"))');
    expect(nativeVoiceAura).not.toContain("private var effect: RenderEffect?");
    expect(nativeVoiceAura).toContain("uniform shader contents;");
    expect(nativeVoiceAura).toContain("half4 foreground = contents.eval(st * iResolution);");
    expect(nativeVoiceAura).toContain("half4 color = mix(foreground, background, half4(bgMask * intensity));");
    expect(nativeVoiceAura).not.toContain("makeImageFromView");
    expect(nativeVoiceAura).not.toContain("ImageShader");
  });

  it("preserves the upstream shader and limits speech response to its width", () => {
    expect(nativeVoiceAura).toContain("float snoise3(float3 p)");
    expect(nativeVoiceAura).toContain("float circle(float2 st, float2 center, float radius)");
    expect(nativeVoiceAura).toContain('setFloatUniform("uExcess", (16f + 4f * smoothedLevel) * density)');
    expect(nativeVoiceAura).toContain('setFloatUniform("uShimmerAmount", 0.3f)');
    expect(nativeVoiceAura).toContain('setFloatUniform("uWaveStrength", 1f)');
    expect(nativeVoiceAura).toContain("20.0 * log10(rawLevel.coerceAtLeast(0.0001))");

    const nativeShader = nativeVoiceAura.match(/SHADER_SOURCE = """([\s\S]*?)"""/u)?.[1];
    expect(nativeShader).toBeDefined();
    const normalizedShader = nativeShader!.replace(/\s+/gu, " ").trim();
    expect(createHash("sha256").update(normalizedShader).digest("hex"))
      .toBe("b58c322013bb3f75bd0bcdb79e2b22274f642c22f78aa573c520d734a0003091");
  });
});
