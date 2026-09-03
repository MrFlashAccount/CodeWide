import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { PortTransport } from "../src/v2/application/ports/portTransport";
import { PortsResource } from "../src/v2/application/resources/portsResource";
import { ThreadPinsResource } from "../src/v2/application/resources/threadPinsResource";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import { createThreadPinStore } from "../src/v2/infrastructure/persistence/sqliteThreadPinStore.web";
import { formatBytes } from "../src/v2/features/attachments/attachmentDisplay";
import {
  accountSettingsDestination,
  agentDestination,
  attachmentPreviewDestination,
  newThreadDestination,
  portBrowserDestination,
  portDestination,
  portsDestination,
  serverSettingsDestination,
  threadResourceDestination,
} from "../src/v2/features/navigation/routeDestinations";
import {
  opaqueRouteParam,
  qualifiedThreadRouteParams,
  savedServerRouteParam,
  threadRouteParam,
} from "../src/v2/features/navigation/routeParams";

describe("V2 feature surfaces", () => {
  it("owns nested V2 navigation history inside Expo Router stacks", () => {
    const layouts = [
      "../app/(workspace)/_layout.tsx",
      "../app/(workspace)/servers/[savedServerId]/_layout.tsx",
      "../app/(workspace)/servers/[savedServerId]/threads/[threadId]/_layout.tsx",
      "../app/(workspace)/servers/[savedServerId]/threads/[threadId]/agents/_layout.tsx",
    ];
    for (const layout of layouts) {
      const source = readFileSync(new URL(layout, import.meta.url), "utf8");
      expect(source).toContain("<Stack");
      expect(source).toContain("initialRouteName");
      expect(source).not.toContain("<Slot");
    }
    const conversation = readFileSync(
      new URL("../src/v2/features/conversation/ConversationScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(conversation).toContain("onSelect={onSelectResource}");
    expect(conversation).toContain("await onOpenResource(id)");
    const conversationRoute = readFileSync(
      new URL(
        "../app/(workspace)/servers/[savedServerId]/threads/[threadId]/index.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(conversationRoute).toContain(
      "router.push(threadResourceDestination(owner, resourceName))",
    );
    const androidBackHandler = readFileSync(
      new URL("../src/ui/use-android-back-handler.ts", import.meta.url),
      "utf8",
    );
    expect(androidBackHandler).toContain("useIsFocused()");
    expect(androidBackHandler).toContain("!isFocused");
  });

  it("owns one V2 runtime above workspace and modal route groups", () => {
    const root = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
    expect(root).toContain("<V2Application");
    expect(root).toContain('generation.generation === "v2"');
    for (const layout of ["../app/(workspace)/_layout.tsx", "../app/(modal)/_layout.tsx"]) {
      const source = readFileSync(new URL(layout, import.meta.url), "utf8");
      expect(source).not.toContain("V2Application");
    }
  });

  it("keeps workspace content mounted behind route-backed sheets without eager routes", () => {
    const root = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
    expect(root).toContain('<Stack.Screen name="(modal)"');
    expect(root).toContain('presentation: "transparentModal"');
    expect(root).toContain('backgroundColor: "transparent"');
    const modalLayout = readFileSync(
      new URL("../app/(modal)/_layout.tsx", import.meta.url),
      "utf8",
    );
    expect(modalLayout).toContain('presentation: "transparentModal"');
    expect(modalLayout).toContain('backgroundColor: "transparent"');
    const serverLayout = readFileSync(
      new URL("../app/(workspace)/servers/[savedServerId]/_layout.tsx", import.meta.url),
      "utf8",
    );
    expect(serverLayout).not.toContain('<Stack.Screen name="ports"');
    for (const route of [
      "../app/(workspace)/servers/[savedServerId]/ports/index.tsx",
      "../app/(workspace)/servers/[savedServerId]/ports/[profileId].tsx",
      "../app/(workspace)/servers/[savedServerId]/threads/[threadId]/attachments.tsx",
    ]) {
      const source = readFileSync(new URL(route, import.meta.url), "utf8");
      expect(source).toContain("<Stack.Screen options={SCREEN_OPTIONS}");
      expect(source).toContain('presentation: "transparentModal"');
    }
    const changesRoute = readFileSync(
      new URL(
        "../app/(workspace)/servers/[savedServerId]/threads/[threadId]/changes.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(changesRoute).toContain('presentation: "fullScreenModal"');
    for (const feature of ["attachments", "ports"] as const) {
      const source = readFileSync(
        new URL(`../src/v2/features/${feature}/${titleCase(feature)}Screen.tsx`, import.meta.url),
        "utf8",
      );
      expect(source).toContain("<PresentationSheetView");
    }
    const changes = readFileSync(
      new URL("../src/v2/features/changes/ChangesScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(changes).not.toContain("PresentationSheetView");
    expect(changes).toContain("<ChangePreview");
  });

  it("disables V2 route transitions on changing foldable geometry", () => {
    const root = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
    expect(root).toContain('<Stack.Screen name="(workspace)" options={V2_ROUTE_SCREEN_OPTIONS}');
    expect(root).toContain('<Stack.Screen name="(modal)" options={V2_MODAL_SCREEN_OPTIONS}');
    expect(root).toContain('animation: "none"');
    for (const layout of [
      "../app/(workspace)/_layout.tsx",
      "../app/(workspace)/servers/[savedServerId]/_layout.tsx",
      "../app/(workspace)/servers/[savedServerId]/threads/[threadId]/_layout.tsx",
      "../app/(workspace)/servers/[savedServerId]/threads/[threadId]/agents/_layout.tsx",
      "../app/(modal)/_layout.tsx",
    ]) {
      const source = readFileSync(new URL(layout, import.meta.url), "utf8");
      expect(source).toContain('animation: "none"');
    }
  });

  it("keeps the application and native window background dark", () => {
    const root = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
    const nativeTheme = readFileSync(
      new URL("../android/app/src/main/res/values/styles.xml", import.meta.url),
      "utf8",
    );
    expect(root).toContain('const APPLICATION_BACKGROUND = "#101011"');
    expect(root).toContain("contentStyle: { backgroundColor: APPLICATION_BACKGROUND }");
    expect(root).toContain("backgroundColor: APPLICATION_BACKGROUND");
    expect(nativeTheme).toContain(
      '<item name="android:windowBackground">@color/codewide_brand</item>',
    );
  });

  it("keeps Android system bars dark while V2 sheets are open", () => {
    const androidSheet = readFileSync(
      new URL("../src/v2/presentation/surfaces/PresentationSheetView.android.tsx", import.meta.url),
      "utf8",
    );
    const expoUiPatch = readFileSync(
      new URL("../../../patches/@expo__ui@57.0.9.patch", import.meta.url),
      "utf8",
    );
    expect(androidSheet).toContain('from "@expo/ui/jetpack-compose"');
    expect(androidSheet).toContain('<Host colorScheme="dark"');
    expect(androidSheet).toContain("<ModalBottomSheet");
    expect(androidSheet).not.toContain("<BottomSheet");
    expect(expoUiPatch).toContain("isAppearanceLightStatusBars = false");
    expect(expoUiPatch).toContain("isAppearanceLightNavigationBars = false");
  });

  it("uses text shimmer instead of spinner chrome for V2 progress states", () => {
    const shimmer = readFileSync(
      new URL("../src/v2/presentation/text/ShimmerText.tsx", import.meta.url),
      "utf8",
    );
    const nativeShimmer = readFileSync(
      new URL("../src/presentation/text/nativeShimmerText.tsx", import.meta.url),
      "utf8",
    );
    expect(shimmer).toContain('from "../../../presentation/text/nativeShimmerText"');
    expect(shimmer).not.toContain("requireNativeComponent");
    expect(nativeShimmer).toContain(
      'requireNativeComponent<NativeShimmerTextProps>("CodexShimmerText")',
    );
    const productionRoots = ["../src/boot/", "../src/v2/"];
    const spinnerComponent = /<(?:ActivityIndicator|[A-Za-z][A-Za-z0-9]*Spinner)\b/u;
    const violations: string[] = [];
    for (const root of productionRoots) {
      const files = readdirSync(new URL(root, import.meta.url), {
        encoding: "utf8",
        recursive: true,
      }).filter((file) => file.endsWith(".tsx"));
      for (const file of files) {
        const source = readFileSync(new URL(`${root}${file}`, import.meta.url), "utf8");
        if (spinnerComponent.test(source)) {
          violations.push(`${root}${file}`);
        }
      }
    }
    expect(violations).toStrictEqual([]);
  });

  it("does not navigate when the selected server is activated again", () => {
    const threadList = readFileSync(
      new URL("../src/v2/features/threadList/ThreadListScreen.tsx", import.meta.url),
      "utf8",
    );
    const workspace = readFileSync(
      new URL("../src/v2/features/workspace/ServerWorkspaceChrome.tsx", import.meta.url),
      "utf8",
    );
    expect(threadList).toContain(
      "if (candidate === undefined || candidate.id === savedServerId) return;",
    );
    expect(workspace).toContain(
      "if (server === undefined || server.id === activeSavedServerId) return;",
    );
  });

  it("opens on the aggregate thread catalog instead of a server-picker page", () => {
    const screen = readFileSync(
      new URL("../src/v2/features/serverList/ServerListScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(screen).toContain("runtime.aggregate");
    expect(screen).toContain("<ThreadSidebarView");
    expect(screen).toContain("<ServerSelectorView");
    expect(screen).not.toContain("<ServerPickerView");
    expect(screen).not.toContain("All saved servers");
  });

  it("virtualizes the V2 thread catalog with LegendList", () => {
    const source = readFileSync(
      new URL("../src/v2/presentation/navigation/ThreadListView.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('from "@legendapp/list/react-native"');
    expect(source).toContain("<LegendList");
    expect(source).toContain("estimatedItemSize={64}");
    expect(source).toContain("drawDistance={320}");
    expect(source).toContain("onEndReached={loadMore}");
    expect(source).toContain("onEndReachedThreshold={0.45}");
    expect(source).toContain("recycleItems");
    expect(source).not.toContain("SectionList");
  });

  it("publishes and restores client-local thread pins per saved server", async () => {
    const store = createThreadPinStore();
    const server = savedServerId("server-a");
    const thread = threadId("thread-a");
    const first = new ThreadPinsResource(store);
    await first.start();

    await first.setPinned(server, thread, true);
    expect(first.isPinned(server, thread)).toBe(true);

    const restarted = new ThreadPinsResource(store);
    await restarted.start();
    expect(restarted.isPinned(server, thread)).toBe(true);

    await restarted.setPinned(server, thread, false);
    expect(restarted.isPinned(server, thread)).toBe(false);

    const unpinnedRestart = new ThreadPinsResource(store);
    await unpinnedRestart.start();
    expect(unpinnedRestart.isPinned(server, thread)).toBe(false);

    await unpinnedRestart.deleteSavedServer(server);
    expect(unpinnedRestart.isPinned(server, thread)).toBe(false);
  });

  it("keeps every secondary destination qualified by saved server and thread", () => {
    const server = savedServerId("server/one");
    const owner = qualifiedThread(server, threadId("thread/two"));
    expect(newThreadDestination(server)).toEqual({
      params: { savedServerId: "server/one" },
      pathname: "/servers/[savedServerId]/new",
    });
    expect(portsDestination(server)).toEqual({
      params: { savedServerId: "server/one" },
      pathname: "/servers/[savedServerId]/ports",
    });
    expect(portDestination(server, "profile/three")).toEqual({
      params: { profileId: "profile/three", savedServerId: "server/one" },
      pathname: "/servers/[savedServerId]/ports/[profileId]",
    });
    expect(portBrowserDestination(server, "profile/three")).toEqual({
      params: { profileId: "profile/three", savedServerId: "server/one" },
      pathname: "/servers/[savedServerId]/ports/browser/[profileId]",
    });
    expect(accountSettingsDestination(server)).toEqual({
      params: { savedServerId: "server/one" },
      pathname: "/settings/accounts/[savedServerId]",
    });
    expect(serverSettingsDestination(server)).toEqual({
      params: { savedServerId: "server/one" },
      pathname: "/settings/servers/[savedServerId]",
    });
    expect(threadResourceDestination(owner, "attachments")).toEqual({
      params: { savedServerId: "server/one", threadId: "thread/two" },
      pathname: "/servers/[savedServerId]/threads/[threadId]/attachments",
    });
    expect(agentDestination(owner, "agent/three")).toEqual({
      params: {
        agentThreadId: "agent/three",
        savedServerId: "server/one",
        threadId: "thread/two",
      },
      pathname: "/servers/[savedServerId]/threads/[threadId]/agents/[agentThreadId]",
    });
    expect(
      attachmentPreviewDestination({
        attachmentId: "attachment/four",
        owner,
      }),
    ).toEqual({
      params: {
        attachmentId: "attachment/four",
        savedServerId: "server/one",
        threadId: "thread/two",
      },
      pathname: "/servers/[savedServerId]/threads/[threadId]/attachments/[attachmentId]",
    });
  });

  it("rejects malformed runtime route parameters without throwing", () => {
    expect(savedServerRouteParam(undefined)).toBeNull();
    expect(savedServerRouteParam(["server-1"])).toBeNull();
    expect(threadRouteParam("")).toBeNull();
    expect(opaqueRouteParam("x".repeat(257))).toBeNull();
    expect(qualifiedThreadRouteParams({ savedServerId: "server-1" })).toBeNull();
    expect(qualifiedThreadRouteParams({ savedServerId: "server-1", threadId: "thread-1" })).toEqual(
      { savedServerId: "server-1", threadId: "thread-1" },
    );
  });

  it("qualifies durable native port profiles through one saved server", async () => {
    const server = savedServerId("server-1");
    const stopped = {
      enabled: false,
      error: null,
      forwardingKey: null,
      id: "profile-1",
      label: "Web",
      localPort: null,
      port: 3000,
      preference: "included" as const,
      preferredLocalPort: 30_001,
      previewUrl: null,
      savedServerId: server,
      status: "stopped" as const,
      updatedAt: 1,
    };
    const connecting = { ...stopped, enabled: true, status: "connecting" as const, updatedAt: 2 };
    const list = vi.fn<PortTransport["list"]>().mockResolvedValue([]);
    const discover = vi
      .fn<PortTransport["discover"]>()
      .mockResolvedValue({ ports: [], scannedAt: 42 });
    const upsert = vi.fn<PortTransport["upsert"]>().mockResolvedValue(stopped);
    const start = vi.fn<PortTransport["start"]>().mockResolvedValue(connecting);
    const stop = vi.fn<PortTransport["stop"]>().mockResolvedValue(stopped);
    const resource = new PortsResource(
      {
        createTunnel: vi.fn<PortTransport["createTunnel"]>(),
        createProfileId: () => "profile-1",
        deleteTunnel: vi.fn<PortTransport["deleteTunnel"]>().mockResolvedValue(undefined),
        discover,
        list,
        remove: vi.fn<PortTransport["remove"]>().mockResolvedValue(undefined),
        start,
        stop,
        subscribe: () => () => undefined,
        upsert,
      },
      server,
    );
    await resource.refresh();
    expect(resource.snapshot()).toEqual({
      status: "ready",
      value: {
        discoveryError: null,
        discoveryStatus: "ready",
        ports: [],
        profileError: null,
        profiles: [],
        scannedAt: 42,
      },
    });
    const profile = await resource.create({
      forwardingKey: null,
      label: "Web",
      port: 3000,
      preferredLocalPort: 30_001,
      profileId: "profile-1",
      start: true,
    });
    expect(profile).toMatchObject({ enabled: true, id: "profile-1", status: "connecting" });
    await resource.stop("profile-1");
    expect(list).toHaveBeenCalledWith(server);
    expect(upsert).toHaveBeenCalledWith(server, {
      forwardingKey: null,
      label: "Web",
      port: 3000,
      preference: "included",
      preferredLocalPort: 30_001,
      profileId: "profile-1",
    });
    expect(start).toHaveBeenCalledWith(server, "profile-1");
    expect(stop).toHaveBeenCalledWith(server, "profile-1");
  });

  it("renders bounded attachment sizes", () => {
    expect(formatBytes("12")).toBe("12 B");
    expect(formatBytes("1536")).toBe("1.5 KB");
    expect(formatBytes("invalid")).toBe("invalid bytes");
  });

  it("keeps all resource surfaces functional inside the V2 ownership boundary", () => {
    const attachments = readFileSync(
      new URL("../src/v2/features/attachments/AttachmentsScreen.tsx", import.meta.url),
      "utf8",
    );
    const attachmentPreview = readFileSync(
      new URL("../src/v2/features/attachments/AttachmentPreviewScreen.tsx", import.meta.url),
      "utf8",
    );
    const attachmentPreviewContent = readFileSync(
      new URL("../src/v2/features/attachments/AttachmentPreviewContent.tsx", import.meta.url),
      "utf8",
    );
    const changes = readFileSync(
      new URL("../src/v2/features/changes/ChangesScreen.tsx", import.meta.url),
      "utf8",
    );
    const changeDiff = readFileSync(
      new URL("../src/v2/presentation/changes/ChangeDiffView.tsx", import.meta.url),
      "utf8",
    );
    const ports = readFileSync(
      new URL("../src/v2/features/ports/PortsScreen.tsx", import.meta.url),
      "utf8",
    );
    const browser = readFileSync(
      new URL("../src/v2/presentation/browser/InternalBrowserView.tsx", import.meta.url),
      "utf8",
    );
    const browserScreen = readFileSync(
      new URL("../src/v2/features/ports/BrowserScreen.tsx", import.meta.url),
      "utf8",
    );
    const terminal = readFileSync(
      new URL("../src/v2/features/terminal/TerminalScreen.tsx", import.meta.url),
      "utf8",
    );

    expect(attachments).not.toContain("isLocalUri");
    expect(attachmentPreview).toContain("runtime.preview(");
    expect(attachmentPreviewContent).toContain(
      "isVideoAttachment(attachment.name, attachment.mediaType)",
    );
    expect(changes).toContain("<ChangePreview");
    expect(changes).toContain('kind: "thread.change"');
    expect(changes).not.toContain("/v2/files/preview?path=");
    expect(changeDiff).toContain("result.patches.map");
    expect(changeDiff).toContain("result.source");
    expect(ports).toContain('useState<ServiceSegment>("active")');
    expect(ports).toContain("portBrowserDestination(");
    expect(browserScreen).toContain("profile.previewUrl");
    expect(browserScreen).not.toContain("runtime.preview(");
    expect(browser).toContain("<WebView");
    expect(browser).toContain("Loading browser…");
    expect(terminal).toContain("useTerminalPlatform");
    expect(terminal).toContain("<RouteBinding");
    expect(terminal).toContain("runtime.terminal.workspaceSnapshot(owner)");
    expect(terminal).not.toContain('from "expo-libghostty"');
    expect(terminal).not.toContain("native-transport");
  });

  it("uses only the authoritative source generation for generation-bound resources", () => {
    const terminal = readFileSync(
      new URL("../src/v2/features/terminal/TerminalScreen.tsx", import.meta.url),
      "utf8",
    );
    const voice = readFileSync(
      new URL("../src/v2/application/ports/voiceTransport.ts", import.meta.url),
      "utf8",
    );
    expect(terminal).toContain("generation: projection.sourceGeneration");
    expect(terminal).toContain('currentThread?.id !== props.owner.threadId');
    expect(terminal).not.toContain("projection.generationId");
    expect(voice).toContain("sourceGeneration: V2U64");
    expect(voice).not.toContain("generationId");
  });
});

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
