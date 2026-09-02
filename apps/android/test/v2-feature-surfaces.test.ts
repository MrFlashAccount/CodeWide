import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { PortTransport } from "../src/v2/application/ports/portTransport";
import { PortsResource } from "../src/v2/application/resources/portsResource";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import { formatBytes } from "../src/v2/features/attachments/attachmentDisplay";
import {
  accountSettingsDestination,
  agentDestination,
  attachmentPreviewDestination,
  newThreadDestination,
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
    const newThread = readFileSync(
      new URL("../src/v2/features/threadList/NewThreadScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(newThread).toContain("router.replace(");
    expect(newThread).not.toContain("router.push(");
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
      "../app/(workspace)/servers/[savedServerId]/threads/[threadId]/attachments.tsx",
      "../app/(workspace)/servers/[savedServerId]/threads/[threadId]/changes.tsx",
    ]) {
      const source = readFileSync(new URL(route, import.meta.url), "utf8");
      expect(source).toContain("<Stack.Screen options={SCREEN_OPTIONS}");
      expect(source).toContain('presentation: "transparentModal"');
    }
    for (const feature of ["attachments", "changes", "ports"] as const) {
      const source = readFileSync(
        new URL(`../src/v2/features/${feature}/${titleCase(feature)}Screen.tsx`, import.meta.url),
        "utf8",
      );
      expect(source).toContain("<PresentationSheetView");
    }
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

  it("uses text shimmer instead of spinner chrome for V2 progress states", () => {
    const shimmer = readFileSync(
      new URL("../src/v2/presentation/text/ShimmerText.tsx", import.meta.url),
      "utf8",
    );
    expect(shimmer).toContain('requireNativeComponent<NativeShimmerTextProps>("CodexShimmerText")');
    for (const surface of [
      "../src/v2/presentation/conversation/TimelineView.tsx",
      "../src/v2/presentation/feedback/ResourceStateView.tsx",
      "../src/v2/presentation/input/ComposerContextStripView.tsx",
      "../src/v2/presentation/input/ComposerView.tsx",
      "../src/v2/presentation/navigation/ThreadListView.tsx",
      "../src/v2/presentation/navigation/ThreadSidebarView.tsx",
    ]) {
      const source = readFileSync(new URL(surface, import.meta.url), "utf8");
      expect(source).not.toContain("ActivityIndicator");
    }
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
    expect(source).toContain("recycleItems");
    expect(source).not.toContain("SectionList");
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
        mediaType: "video/mp4",
        name: "recording.mp4",
        owner,
        sourceUri: "file:///recording.mp4",
      }),
    ).toEqual({
      params: {
        attachmentId: "attachment/four",
        mediaType: "video/mp4",
        name: "recording.mp4",
        savedServerId: "server/one",
        sourceUri: "file:///recording.mp4",
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

  it("qualifies port discovery and tunnel lifecycle through one saved server", async () => {
    const server = savedServerId("server-1");
    const list = vi.fn<PortTransport["list"]>().mockResolvedValue({ ports: [], scannedAt: 42 });
    const createTunnel = vi
      .fn<PortTransport["createTunnel"]>()
      .mockResolvedValue({ id: "tunnel-1", expiresAt: 99, basePath: "/v2/tunnels/tunnel-1/" });
    const deleteTunnel = vi.fn<PortTransport["deleteTunnel"]>().mockResolvedValue(undefined);
    const resource = new PortsResource({ createTunnel, deleteTunnel, list }, server);
    await resource.refresh();
    expect(resource.snapshot()).toEqual({ status: "ready", value: { ports: [], scannedAt: 42 } });
    await expect(resource.createTunnel(3000)).resolves.toMatchObject({ id: "tunnel-1" });
    await resource.deleteTunnel("tunnel-1");
    expect(list).toHaveBeenCalledWith(server);
    expect(createTunnel).toHaveBeenCalledWith(server, 3000);
    expect(deleteTunnel).toHaveBeenCalledWith(server, "tunnel-1");
  });

  it("renders bounded attachment sizes", () => {
    expect(formatBytes("12")).toBe("12 B");
    expect(formatBytes("1536")).toBe("1.5 KB");
    expect(formatBytes("invalid")).toBe("invalid bytes");
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
    expect(terminal).toContain("projection.sourceGeneration");
    expect(terminal).not.toContain("projection.generationId");
    expect(voice).toContain("sourceGeneration: V2U64");
    expect(voice).not.toContain("generationId");
  });

  it("keeps only the active draft locked and recovered work visible until typed settlement", () => {
    const newThread = readFileSync(
      new URL("../src/v2/features/threadList/NewThreadForm.tsx", import.meta.url),
      "utf8",
    );
    const composer = readFileSync(
      new URL("../src/v2/features/composer/ChatComposer.tsx", import.meta.url),
      "utf8",
    );
    const composerView = readFileSync(
      new URL("../src/v2/presentation/input/ComposerView.tsx", import.meta.url),
      "utf8",
    );
    const correlations = readFileSync(
      new URL("../src/v2/application/resources/commandCorrelationResource.ts", import.meta.url),
      "utf8",
    );
    expect(newThread).toContain("setActivationLocked(true)");
    expect(newThread).toContain('accessibilityLiveRegion="polite"');
    expect(newThread).toContain("disabled={activationLocked}");
    expect(newThread).toContain("locked={locallyLocked}");
    expect(composer).toContain("<ComposerView");
    expect(composer).toContain("disabled={disabled || locked === true}");
    expect(composer).toContain("pending={sending}");
    expect(composerView).toContain("editable={!disabled && !pending}");
    expect(composerView).toContain(
      "accessibilityState={{ busy: pending, disabled: sendDisabled }}",
    );
    expect(composerView).toContain('accessibilityLiveRegion="polite"');
    expect(correlations).toContain("this.#commands.subscribe");
    expect(correlations).toContain("#onSettlement");
    expect(newThread).toContain("correlations.retainLock");
    expect(newThread).toContain("correlations.isLocked(");
  });
});

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
