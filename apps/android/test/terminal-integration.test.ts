import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const terminal = readFileSync(new URL("../src/ui/TerminalWorkspace.native.tsx", import.meta.url), "utf8");
const transport = readFileSync(new URL("../src/native/native-transport.native.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/data/interactive-terminal-store.native.ts", import.meta.url), "utf8");
const nativeManager = readFileSync(
  new URL("../android/app/src/main/java/dev/codewide/app/remote/NativeTerminalSessionManager.kt", import.meta.url),
  "utf8",
);

describe("native terminal integration", () => {
  it("opens a thread-bound workspace through the shared fullscreen overlay host", () => {
    expect(screen).toContain('{ id: "terminal", label: "Open terminal"');
    expect(screen).toContain("fullscreenOverlay.present(({ close }) => (");
    expect(screen).toContain("<TerminalWorkspace connectionId={draftConnectionId} threadId={draftThreadId}");
    expect(screen).toContain('ComposerContextCount label="Terminals"');
    expect(screen).toContain("interactiveTerminals.tabs.length");
  });

  it("minimizes without closing tabs and replays ordered output into libghostty", () => {
    expect(terminal).toContain('from "expo-libghostty"');
    expect(terminal).toContain('accessibilityLabel="Minimize terminal"');
    expect(terminal).toContain("readNativeTerminalOutput(tab.id, nextOffsetRef.current)");
    expect(terminal).not.toContain("closeNativeTerminal(sessionId)");
    expect(store).toContain("closeInteractiveTerminalTab");
    expect(store).toContain("threadId: input.threadId");
  });

  it("keeps the companion wire binary and the resumable transcript in Android cache", () => {
    expect(terminal).toContain("subscribeNativeTerminal");
    expect(terminal).toContain("writeNativeTerminal(tab.id, data)");
    expect(transport).toContain('addListener("CodeWideTerminalEvent"');
    expect(transport).toContain("readTerminalOutput(sessionId, offset, maxBytes)");
    expect(nativeManager).toContain("CertificatePinner.Builder()");
    expect(nativeManager).toContain('Regex("terminal-[0-9a-fA-F-]{36}")');
    expect(nativeManager).toContain('File(cacheDirectory, "terminal-sessions")');
    expect(nativeManager).toContain("MAX_TRANSCRIPT_BYTES = 128L * 1024 * 1024");
  });
});
