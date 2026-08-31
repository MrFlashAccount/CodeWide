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
  newThreadDestination,
  portDestination,
  portsDestination,
  serverSettingsDestination,
  threadResourceDestination,
} from "../src/v2/features/navigation/routeDestinations";

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
    expect(conversation).toContain("run: () => onOpenResource(resourceName)");
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

  it("keeps every secondary destination qualified by saved server and thread", () => {
    const server = savedServerId("server/one");
    const owner = qualifiedThread(server, threadId("thread/two"));
    expect(newThreadDestination(server)).toBe("/servers/server%2Fone/new");
    expect(portsDestination(server)).toBe("/servers/server%2Fone/ports");
    expect(portDestination(server, "profile/three")).toBe(
      "/servers/server%2Fone/ports/profile%2Fthree",
    );
    expect(accountSettingsDestination(server)).toBe("/settings/accounts/server%2Fone");
    expect(serverSettingsDestination(server)).toBe("/settings/servers/server%2Fone");
    expect(threadResourceDestination(owner, "attachments")).toBe(
      "/servers/server%2Fone/threads/thread%2Ftwo/attachments",
    );
    expect(agentDestination(owner, "agent/three")).toBe(
      "/servers/server%2Fone/threads/thread%2Ftwo/agents/agent%2Fthree",
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
    const correlations = readFileSync(
      new URL("../src/v2/application/resources/commandCorrelationResource.ts", import.meta.url),
      "utf8",
    );
    expect(newThread).toContain("setActivationLocked(true)");
    expect(newThread).toContain('accessibilityLiveRegion="polite"');
    expect(newThread).toContain("editable={!activationLocked && !locallyLocked}");
    expect(composer).toContain("accessibilityState={{");
    expect(composer).toContain("busy: sending");
    expect(composer).toContain('accessibilityLiveRegion="polite"');
    expect(correlations).toContain("this.#commands.subscribe");
    expect(correlations).toContain("#onSettlement");
    expect(newThread).toContain("correlations.retainLock");
    expect(newThread).toContain("correlations.isLocked(");
  });
});
