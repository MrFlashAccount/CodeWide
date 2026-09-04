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

  it("uses the same server picker on expanded layouts instead of a server rail", () => {
    const desktop = screen.slice(
      screen.indexOf("<View style={styles.desktopWorkspace}>"),
      screen.indexOf("function ForwardedLoopbackBrowser("),
    );
    const sidebar = screen.slice(
      screen.indexOf("function ThreadSidebar("),
      screen.indexOf("function SelectableThreadRow("),
    );

    expect(desktop).not.toContain("<ServerRail");
    expect(screen).not.toContain('testID="server-rail"');
    expect(sidebar).toContain('accessibilityLabel="Choose server"');
    expect(sidebar).toContain("<MobileServerSheet");
  });

  it("keeps the server selector and sheet single-line with status-only accessories", () => {
    const mobileThreads = screen.slice(
      screen.indexOf("function MobileThreads("),
      screen.indexOf("function TopBarAction("),
    );
    const serverSheet = screen.slice(
      screen.indexOf("function MobileServerSheet("),
      screen.indexOf("function VoiceCaptureStatus("),
    );

    expect(mobileThreads).toContain('activeServer?.name ?? "All servers"');
    expect(mobileThreads).not.toContain("connectionStateLabel(activeServer.status)");
    expect(mobileThreads).not.toContain('name="chevron-down"');
    expect(mobileThreads).toContain("<ConnectionActivityIndicator status={selectorStatus} />");
    expect(screen).toContain('initialOffset={mobileThreadOffset.read(`${activeServerId}:${threadListMode}`)}');
    expect(screen).toContain('onOffsetChange={(offset) => mobileThreadOffset.write(`${activeServerId}:${threadListMode}`, offset)}');
    expect(serverSheet).not.toContain("subtitle={connectionStateLabel(server.status)}");
    expect(serverSheet).toContain("titleAccessory={<ConnectionActivityIndicator status={server.status} />}");
  });

  it("exposes Accounts from the thread-list menu", () => {
    const menu = screen.slice(
      screen.indexOf("function ThreadListMenu("),
      screen.indexOf("function ThreadFilterMenu("),
    );

    expect(menu).toContain('id: "accounts"');
    expect(menu).toContain('label: "Accounts"');
    expect(menu).toContain("onPress: onOpenAccounts");
  });
});
