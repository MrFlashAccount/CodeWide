import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const androidRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = join(androidRoot, "android", "app", "src");
const receiverName = "dev.codewide.app.e2e.V2VoiceFaultReceiver";
const action = "dev.codewide.app.e2e.VOICE_FAULT";

function source(path: string): string {
  return readFileSync(join(appSource, path), "utf8");
}

describe("native Voice E2E fault boundary", () => {
  it("exports the shell-protected receiver only from the E2E manifest", () => {
    const e2e = source("e2e/AndroidManifest.xml");
    expect(e2e).toContain(`android:name="${receiverName}"`);
    expect(e2e).toContain(`android:name="${action}"`);
    expect(e2e).toContain('android:permission="android.permission.DUMP"');

    for (const manifest of [
      "main/AndroidManifest.xml",
      "debug/AndroidManifest.xml",
      "debugOptimized/AndroidManifest.xml",
    ]) {
      expect(source(manifest)).not.toContain(receiverName);
      expect(source(manifest)).not.toContain(action);
    }
  });

  it("keeps the receiver and its allow-list out of production source", () => {
    const receiver = source("e2e/java/dev/codewide/app/e2e/V2VoiceFaultReceiver.kt");
    expect(receiver).toContain('STOP_ACTIVE_CAPTURE("stop-active-capture")');
    expect(receiver).toContain('REVOKE_MICROPHONE_ON_KILL("revoke-microphone-on-kill")');
    expect(receiver).not.toContain('"retry"');
    expect(receiver).not.toContain('"transcription-error"');
    expect(receiver).not.toContain('"submit-error"');
  });
});
