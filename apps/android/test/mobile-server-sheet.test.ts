import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");

describe("compact mobile server navigation", () => {
  it("keeps settings inside the server sheet instead of the top bar", () => {
    const mobileThreads = screen.slice(
      screen.indexOf("function MobileThreads("),
      screen.indexOf("function TopBarAction("),
    );
    const serverSheet = screen.slice(
      screen.indexOf("function MobileServerSheet("),
      screen.indexOf("function VoiceCaptureStatus("),
    );

    expect(mobileThreads).not.toContain('TopBarAction icon="settings-outline"');
    expect(mobileThreads).toContain("onSettings={() => { setServerPickerVisible(false); onSettings(); }}");
    expect(serverSheet).toContain('<MenuAction icon="settings-outline" title="Settings"');
  });
});
