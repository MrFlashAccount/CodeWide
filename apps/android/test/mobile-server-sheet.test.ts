import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");

describe("compact mobile server navigation", () => {
  it("keeps server management in the server sheet and new thread in the top bar", () => {
    const mobileThreads = screen.slice(
      screen.indexOf("function MobileThreads("),
      screen.indexOf("function TopBarAction("),
    );
    const serverSheet = screen.slice(
      screen.indexOf("function MobileServerSheet("),
      screen.indexOf("function VoiceCaptureStatus("),
    );

    expect(mobileThreads).not.toContain('TopBarAction icon="settings-outline"');
    expect(mobileThreads).not.toContain('TopBarAction icon="add"');
    expect(mobileThreads).toContain('<TopBarAction icon="create-outline" accessibilityLabel="New thread" onPress={onNewThread} />');
    expect(mobileThreads).not.toContain("styles.newThreadFab");
    expect(mobileThreads).toContain("onAddServer={() => { setServerPickerVisible(false); onAddServer(); }}");
    expect(mobileThreads).toContain("onSettings={() => { setServerPickerVisible(false); onSettings(); }}");
    expect(serverSheet).toContain('<MenuAction icon="add" title="Add server"');
    expect(serverSheet).toContain('<MenuAction icon="settings-outline" title="Settings"');
  });
});
