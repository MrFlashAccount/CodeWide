import { readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource, sourceObjectDeclaration } from "./source-contract";

const screen = compactSource(
  readFileSync(new URL("../app/v1/_layout.tsx", import.meta.url), "utf8"),
);
const terminal = readFileSync(
  new URL("../src/features/terminal/TerminalWorkspace.native.tsx", import.meta.url),
  "utf8",
);
const transport = readFileSync(
  new URL("../src/native/native-transport.native.ts", import.meta.url),
  "utf8",
);
const store = readFileSync(
  new URL("../src/data/interactive-terminal-store.native.ts", import.meta.url),
  "utf8",
);
const nativeManager = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/NativeTerminalSessionManager.kt",
    import.meta.url,
  ),
  "utf8",
);

const ownerTerminalFeature = compactSource(
  readFileSync(
    new URL("../app/v1/threads/[connectionId]/[threadId]/terminal.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerComposerTerminalContextChip = compactSource(
  readFileSync(
    new URL("../src/features/terminal/ComposerTerminalContextChip.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerTerminalTabNative = readFileSync(
  new URL("../src/features/terminal/TerminalTab.native.tsx", import.meta.url),
  "utf8",
);
const ownerManageTerminalsSheet = readFileSync(
  new URL("../src/features/terminal/ManageTerminalsSheet.tsx", import.meta.url),
  "utf8",
);
const nativeInventory = readFileSync(
  new URL("../src/data/nativeTerminalInventory.native.ts", import.meta.url),
  "utf8",
);
const portsRow = readFileSync(
  new URL("../src/features/ports/ForwardingRow.tsx", import.meta.url),
  "utf8",
);
const ownerThreadListMenu = readFileSync(
  new URL("../src/features/threadList/ThreadListMenus.tsx", import.meta.url),
  "utf8",
);
const ownerWorkspaceComposition = readFileSync(
  new URL("../app/v1/V1WorkspaceRouteComposition.tsx", import.meta.url),
  "utf8",
);
const ownerWorkspaceShell = readFileSync(
  new URL("../app/v1/V1WorkspaceShell.tsx", import.meta.url),
  "utf8",
);

const ownerTerminalActions = readFileSync(
  new URL("../src/features/terminal/terminalActions.ts", import.meta.url),
  "utf8",
);
const terminalStyles = readFileSync(
  new URL("../src/features/terminal/TerminalWorkspace.styles.ts", import.meta.url),
  "utf8",
);

const ownerComposerAccessoryTray = compactSource(
  readFileSync(
    new URL("../src/features/composer/ComposerAccessoryTray.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerComposerFeatureActions = compactSource(
  readFileSync(
    new URL("../src/features/composer/composerFeatureActions.ts", import.meta.url),
    "utf8",
  ),
);

const detailOwner = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationDetail.tsx", import.meta.url),
    "utf8",
  ),
);

const publication = compactSource(
  readFileSync(
    new URL("../src/features/conversation/MainConversationPublication.tsx", import.meta.url),
    "utf8",
  ),
);

const historyBinding = compactSource(
  readFileSync(
    new URL("../src/features/conversation/mainConversationHistory.ts", import.meta.url),
    "utf8",
  ),
);

describe("native terminal integration", () => {
  it("manages existing terminal tabs from the thread-list overflow menu", () => {
    expect(ownerThreadListMenu).toContain('label: "Manage terminals"');
    expect(ownerThreadListMenu).toContain("onPress: onManageTerminals");
    expect(ownerWorkspaceComposition).toContain("<ManageTerminalsSheet");
    expect(ownerWorkspaceComposition).toContain("refreshNativeTerminalInventory()");
    expect(ownerWorkspaceComposition).toContain("focusInteractiveTerminalSession(terminal)");
    expect(ownerWorkspaceComposition).toContain("closeInteractiveTerminalSession(sessionId)");
    expect(ownerWorkspaceComposition).not.toContain('pathname: "/v1/terminals');
    expect(ownerWorkspaceShell).not.toContain('name="terminals/');
    expect(nativeInventory).toContain("listNativeTerminals()");
    expect(nativeManager).toContain("fun listRunning(): String");
    expect(nativeManager).toContain("session.disposed.get() || session.finished");
    expect(transport).toContain("await bridge.listTerminals()");
    expect(ownerManageTerminalsSheet).not.toContain("createInteractiveTerminalTab");
  });

  it("uses the Ports row overflow trigger and keeps it separate from row focus", () => {
    expect(portsRow).toContain("<AppListRowMenuTrigger");
    expect(ownerManageTerminalsSheet).toContain("<AppListRowMenuTrigger");
    expect(ownerManageTerminalsSheet).toContain("onPress={focus}");
    expect(ownerManageTerminalsSheet).toContain("trailing={");
    expect(ownerManageTerminalsSheet).toContain('id: "close", label: "Close"');
    expect(ownerManageTerminalsSheet).not.toContain("accessibilityLabel={`Close");
  });

  it("opens a thread-bound workspace through a retained route session", () => {
    expect(ownerComposerAccessoryTray).toContain('id: "terminal"');
    expect(ownerComposerAccessoryTray).not.toContain('id: "ports"');
    expect(screen).not.toContain('label: "Open terminal"');
    expect(ownerTerminalActions).toContain("const createAndOpenTerminal = useEvent(() => {");
    expect(ownerComposerFeatureActions).toContain("createAndOpenTerminal();");
    expect(ownerTerminalFeature).toContain("terminalRouteSessions.get");
    expect(ownerTerminalFeature).toMatch(
      /<TerminalWorkspace(?=[^>]*connectionId=\{session\.request\.connectionId\})(?=[^>]*threadId=\{session\.request\.threadId\})[^>]*>/u,
    );
    expect(ownerTerminalFeature).toContain("terminalRouteSessions.close(session.id)");
    expect(ownerTerminalFeature).toContain(
      "recoverUnavailableRoute(router, v1ThreadDestination(params.value))",
    );
    expect(ownerComposerTerminalContextChip).toContain('ComposerContextCount label="Terminals"');
    expect(ownerComposerTerminalContextChip).toContain("workspace.tabs.length");
  });

  it("uses the exact loaded thread cwd instead of the list-loading fallback", () => {
    const detail = historyBinding;
    expect(detail).toContain(
      'const conversationCwd = remoteThread?.cwd ?? storedThread?.cwd ?? conversation.cwd ?? "/workspace";',
    );
    expect(publication).toContain("cwd: history.conversationCwd");
  });

  it("keeps the live terminal renderer mounted across responsive layout changes", () => {
    const overlay = readFileSync(
      new URL("../src/ui/AppFullscreenOverlay.tsx", import.meta.url),
      "utf8",
    );
    expect(overlay).toContain("dismissOnScopeUnmount: options?.dismissOnScopeUnmount ?? true");
    expect(overlay).toContain("host.dismissUnmountedScope(scope)");
    expect(overlay).toContain("entry.scope === scope && entry.dismissOnScopeUnmount");
  });

  it("re-arms fullscreen readiness for every modal opening", () => {
    const modal = readFileSync(
      new URL("../src/ui/AppFullscreenModal.native.tsx", import.meta.url),
      "utf8",
    );
    expect(modal).toContain("!isOpen");
    expect(modal).toContain("return null;");
    expect(compactSource(modal)).toContain("return ( <VisibleFullscreenModal");
    expect(modal).toContain("const [windowReady, setWindowReady] = useState(false);");
  });

  it("minimizes without closing tabs or replaying consumed PTY bytes into libghostty", () => {
    expect(ownerTerminalTabNative).toContain('from "expo-libghostty"');
    expect(terminal).toContain('accessibilityLabel="Minimize terminal"');
    expect(ownerTerminalTabNative).toContain("persistentSessionId={tab.id}");
    expect(ownerTerminalTabNative).toContain("readInteractiveTerminalRenderedOffset(tab.id)");
    expect(ownerTerminalTabNative).toContain(
      "commitInteractiveTerminalRenderedOffset(tab.id, chunk.nextOffset)",
    );
    expect(ownerTerminalTabNative).toContain(
      "readNativeTerminalOutput(tab.id, nextOffsetRef.current)",
    );
    expect(terminal).not.toContain("closeNativeTerminal(sessionId)");
    expect(store).toContain("closeInteractiveTerminalTab");
    expect(store).toContain("threadId: input.threadId");
    expect(store).toContain("releasePersistentTerminalSession(id)");
  });

  it("uses a dense terminal grid that still remains readable on Android", () => {
    expect(ownerTerminalTabNative).toContain("const TERMINAL_FONT_SIZE = 10");
    expect(ownerTerminalTabNative).toContain("fontSize={TERMINAL_FONT_SIZE}");
  });

  it("puts tabs in the terminal title row to recover vertical grid space", () => {
    expect(terminal).toContain("<View style={styles.header}>");
    expect(terminal).toContain("contentContainerStyle={styles.tabList}");
    expect(terminal).toContain("style={styles.tabScroll}");
    expect(terminal).not.toContain("styles.tabBar");
    expect(sourceObjectDeclaration(terminalStyles, "header")).toContain(
      "minHeight: layoutSize.header",
    );
  });

  it("ships one full monospaced Nerd Font for terminal text and symbols", () => {
    const font = new URL(
      "../android/app/src/main/assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf",
      import.meta.url,
    );
    const patch = readFileSync(
      new URL("../../../patches/expo-libghostty@0.8.1.patch", import.meta.url),
      "utf8",
    );
    expect(statSync(font).size).toBeGreaterThan(2_000_000);
    expect(patch).toContain('TERMINAL_FONT_ASSET = "fonts/JetBrainsMonoNerdFontMono-Regular.ttf"');
    expect(patch).toContain("private val textPaint = newTextPaint(terminalTypeface)");
    expect(patch).toContain("private val symbolsPaint = newTextPaint(terminalTypeface)");
  });

  it("retains only logical VT state and recreates Android render resources", () => {
    const patch = readFileSync(
      new URL("../../../patches/expo-libghostty@0.8.1.patch", import.meta.url),
      "utf8",
    );
    expect(patch).toContain('Prop("persistentSessionId")');
    expect(patch).toContain("PersistentTerminalRegistry.acquire(id)");
    expect(patch).toContain("internal class GhosttyTerminalSession");
    expect(patch).toContain("val session: GhosttyTerminalSession");
    expect(patch).toContain("previousTerminal.destroyRenderer()");
    expect(patch).toContain("terminal = GhosttyTerminalView(context, nextSession)");
    expect(patch).toContain("Views, geometry and bitmap caches are always recreated");
    expect(patch).not.toContain("val terminal: GhosttyTerminalView,");
    expect(patch).toContain('AsyncFunction("releasePersistentSession")');
  });

  it("releases full-screen bitmap caches without destroying the retained VT session", () => {
    const patch = readFileSync(
      new URL("../../../patches/expo-libghostty@0.8.1.patch", import.meta.url),
      "utf8",
    );
    expect(patch).toContain("fun destroyRenderer()");
    expect(patch).toContain("backgroundBitmap?.recycle()");
    expect(patch).toContain("textBitmap?.recycle()");
    expect(patch).toContain("snapshotBuf = null");
    expect(patch).toContain("GhosttyVt.nativeClearSelection(handle)");
    expect(patch).toContain("selectionMode = false");
    expect(patch).toContain("session.destroy()");
  });

  it("restores the full terminal grid after the Android IME disappears", () => {
    const patch = readFileSync(
      new URL("../../../patches/expo-libghostty@0.8.1.patch", import.meta.url),
      "utf8",
    );
    expect(patch).toContain("WindowInsetsAnimationCompat.Callback");
    expect(patch).toContain("ViewCompat.requestApplyInsets(this)");
    expect(patch).toContain("override fun onWindowFocusChanged(hasWindowFocus: Boolean)");
    expect(patch).toContain("resetImeLayout()");
  });

  it("does not retain a stale keyboard gap across terminal tab switches", () => {
    const patch = readFileSync(
      new URL("../../../patches/expo-libghostty@0.8.1.patch", import.meta.url),
      "utf8",
    );
    expect(patch).toContain("view.releaseKeyboard()");
    expect(patch).toContain("hideSoftInputFromWindow(token, 0)");
    expect(patch).toContain("lastImeAnimationInsets = insets");
    expect(patch).toContain("syncAccessoryBar(insets)");
    expect(patch).toContain(
      "terminal.isAttachedToWindow && terminal.isFocused && hasWindowFocus()",
    );
    expect(patch).toContain("imeVisible && terminalOwnsIme");
    expect(patch).toContain(
      "if (finalInsets == null) reconcileLayout() else syncAccessoryBar(finalInsets)",
    );
    expect(patch).toContain("if (!isAttachedToWindow) return@post");
    expect(patch).toContain("if (!isAttachedToWindow || !isFocused) return@post");
  });

  it("reconciles a retained PTY grid on its first layout after remount", () => {
    const patch = readFileSync(
      new URL("../../../patches/expo-libghostty@0.8.1.patch", import.meta.url),
      "utf8",
    );
    expect(patch).toContain("terminal.prepareForReattach()");
    expect(patch).toContain("forceGridGeometryOnNextLayout = true");
    expect(patch).toContain("override fun onLayout(changed: Boolean");
    expect(patch).toContain("updateGridGeometry(force = true)");
  });

  it("keeps ordinary renderer layouts on the upstream resize lifecycle", () => {
    const patch = readFileSync(
      new URL("../../../patches/expo-libghostty@0.8.1.patch", import.meta.url),
      "utf8",
    );
    expect(patch).toContain("if (!forceGridGeometryOnNextLayout) return");
    expect(patch).not.toContain("every final child layout must reconcile");
  });

  it("reconciles terminal geometry after the fullscreen window reaches final bounds", () => {
    const patch = readFileSync(
      new URL("../../../patches/expo-libghostty@0.8.1.patch", import.meta.url),
      "utf8",
    );
    expect(ownerTerminalTabNative).toContain("useFullscreenWindowReady()");
    expect(ownerTerminalTabNative).toContain("terminalRef.current?.reconcileLayout?.()");
    expect(patch).toContain('AsyncFunction("reconcileLayout")');
    expect(patch).toContain("fun reconcileLayout()");
    expect(patch).toContain("terminal.prepareForReattach()");
    expect(patch).toContain("reconcileLayout: () => native.current!.reconcileLayout!()");
    expect(patch).not.toContain("reconcileLayout: whenReady");
  });

  it("keeps terminal navigation controls visible without the Android keyboard", () => {
    const patch = readFileSync(
      new URL("../../../patches/expo-libghostty@0.8.1.patch", import.meta.url),
      "utf8",
    );
    expect(patch).toContain("bar.visibility = VISIBLE");
    expect(patch).toContain("accessoryBar.visibility = VISIBLE");
    expect(patch).toContain("The terminal controls are part of the workspace and stay visible");
  });

  it("maps taps to primary mouse clicks only for mouse-aware terminal apps", () => {
    const patch = readFileSync(
      new URL("../../../patches/expo-libghostty@0.8.1.patch", import.meta.url),
      "utf8",
    );
    expect(patch).toContain("nativeEncodeMouseTap");
    expect(patch).toContain("GHOSTTY_TERMINAL_DATA_MOUSE_TRACKING");
    expect(patch).toContain("GHOSTTY_MOUSE_ACTION_PRESS");
    expect(patch).toContain("GHOSTTY_MOUSE_ACTION_RELEASE");
    expect(patch).toContain("if (mouseInput != null)");
  });

  it("keeps keyboard invocation explicit when a TUI consumes taps as mouse clicks", () => {
    const patch = readFileSync(
      new URL("../../../patches/expo-libghostty@0.8.1.patch", import.meta.url),
      "utf8",
    );
    expect(patch).toContain('addKey("⌨") { onKeyboard?.invoke() }');
    expect(patch).toContain("bar.onKeyboard = { terminal.showKeyboard() }");
    expect(patch).toContain("fun showKeyboard()");
    expect(patch).toContain("InputMethodManager.SHOW_IMPLICIT");
  });

  it("renders Kitty graphics through libghostty without reimplementing the protocol", () => {
    const patch = readFileSync(
      new URL("../../../patches/expo-libghostty@0.8.1.patch", import.meta.url),
      "utf8",
    );
    expect(patch).toContain("GHOSTTY_TERMINAL_OPT_KITTY_IMAGE_STORAGE_LIMIT");
    expect(patch).toContain("AImageDecoder_createFromBuffer");
    expect(patch).toContain("nativeKittyPlacements");
    expect(patch).toContain("nativeCopyKittyImage");
    expect(patch).toContain("ghostty_kitty_graphics_placement_render_info");
    expect(patch).toContain("drawKittyLayer(canvas, KITTY_LAYER_BELOW_TEXT)");
    expect(patch).toContain("drawKittyLayer(canvas, KITTY_LAYER_ABOVE_TEXT)");
    expect(patch).toContain("ghostty-vt jnigraphics log");
    expect(patch).toContain("const bool remoteMediumDisabled = false");
    expect(patch).toContain("GHOSTTY_TERMINAL_OPT_KITTY_IMAGE_MEDIUM_FILE");
    expect(patch).toContain("GHOSTTY_TERMINAL_OPT_KITTY_IMAGE_MEDIUM_TEMP_FILE");
    expect(patch).toContain("GHOSTTY_TERMINAL_OPT_KITTY_IMAGE_MEDIUM_SHARED_MEM");
  });

  it("keeps the companion wire binary and the resumable transcript in Android cache", () => {
    expect(ownerTerminalTabNative).toContain("subscribeNativeTerminal");
    expect(ownerTerminalTabNative).toContain("writeNativeTerminal(tab.id, data)");
    expect(transport).toContain('addListener("CodeWideTerminalEvent"');
    expect(transport).toContain("readTerminalOutput(sessionId, offset, maxBytes)");
    expect(nativeManager).toContain("InnerTlsTransport.client(socketClient, saved)");
    expect(nativeManager).toContain('Regex("terminal-[0-9a-fA-F-]{36}")');
    expect(nativeManager).toContain('File(cacheDirectory, "terminal-sessions")');
    expect(nativeManager).toContain("MAX_TRANSCRIPT_BYTES = 128L * 1024 * 1024");
  });
});
