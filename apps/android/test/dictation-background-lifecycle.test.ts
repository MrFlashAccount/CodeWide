import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const nativeModule = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt",
    import.meta.url,
  ),
  "utf8",
);
const manifest = readFileSync(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);

function functionBody(name: string): string {
  const start = nativeModule.indexOf(`fun ${name}(`);
  const next = nativeModule.indexOf("\n  }", start);
  if (start < 0 || next < 0) {
    throw new Error(`Could not locate ${name}`);
  }
  return nativeModule.slice(start, next);
}

describe("V1 dictation background lifecycle", () => {
  it("keeps active PCM capture alive across an ordinary host pause", () => {
    expect(functionBody("onHostPause")).not.toContain("stopPcmCaptureInternal()");
    expect(functionBody("onHostDestroy")).toContain("stopPcmCaptureInternal()");
  });

  it("acquires foreground microphone authority before opening AudioRecord", () => {
    const acquire = nativeModule.indexOf("VoiceCaptureForegroundService.acquire(context, token)");
    const begin = nativeModule.indexOf("beginPcmCapture(token, purpose, promise)");
    const openRecorder = nativeModule.indexOf("val activeCapture = microphone.start()");

    expect(acquire).toBeGreaterThan(0);
    expect(begin).toBeGreaterThan(acquire);
    expect(openRecorder).toBeGreaterThan(begin);
    expect(manifest).toContain(
      'android:name="dev.codewide.app.remote.VoiceCaptureForegroundService"',
    );
    expect(manifest).toContain('android:foregroundServiceType="microphone"');
  });

  it("releases foreground ownership on explicit stop and natural capture termination", () => {
    expect(functionBody("stopPcmCaptureInternal")).toContain(
      "stopped.second?.let(VoiceCaptureForegroundService::release)",
    );
    expect(nativeModule).toContain(
      "captureToken?.let(VoiceCaptureForegroundService::release)",
    );
  });
});
