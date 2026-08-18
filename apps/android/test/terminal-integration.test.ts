import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const terminal = readFileSync(new URL("../src/ui/TerminalWorkspace.native.tsx", import.meta.url), "utf8");
const transport = readFileSync(new URL("../src/native/native-transport.native.ts", import.meta.url), "utf8");
const nativeManager = readFileSync(
  new URL("../android/app/src/main/java/dev/codewide/app/remote/NativeTerminalSessionManager.kt", import.meta.url),
  "utf8",
);

describe("native terminal integration", () => {
  it("opens from the thread menu through the shared fullscreen overlay host", () => {
    expect(screen).toContain('{ id: "terminal", label: "Open terminal"');
    expect(screen).toContain("fullscreenOverlay.present(({ close }) => (");
    expect(screen).toContain("<TerminalWorkspace connectionId={draftConnectionId}");
  });

  it("keeps the renderer behind a binary native transport seam", () => {
    expect(terminal).toContain('from "expo-libghostty"');
    expect(terminal).toContain("subscribeNativeTerminal");
    expect(terminal).toContain("writeNativeTerminal(sessionId, data)");
    expect(transport).toContain('addListener("CodeWideTerminalEvent"');
    expect(nativeManager).toContain("CertificatePinner.Builder()");
    expect(nativeManager).toContain('Regex("terminal-[0-9a-fA-F-]{36}")');
  });
});
