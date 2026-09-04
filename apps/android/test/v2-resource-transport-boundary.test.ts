import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { savedServerId } from "../src/v2/domain/ids";
import { createClosedPortTransport } from "../src/v2/infrastructure/ports/closedPortTransport.native";
import { createClosedPreviewTransport } from "../src/v2/infrastructure/preview/closedPreviewTransport.native";

const transportMocks = vi.hoisted(() => ({
  acquireSharedConnectionLease: vi.fn(),
  companionHttpOrigin: vi.fn(),
  mintStoredSession: vi.fn(),
  release: vi.fn(async () => undefined),
  request: vi.fn(),
}));

vi.mock("react-native", () => ({
  NativeEventEmitter: class NativeEventEmitter {
    addListener(): { remove(): void } {
      return { remove: () => undefined };
    }
  },
  NativeModules: {
    CodeWideNative: {
      companionHttpOrigin: transportMocks.companionHttpOrigin,
      mintStoredSession: transportMocks.mintStoredSession,
    },
  },
  Platform: { OS: "android" },
}));

vi.mock("expo-file-system", () => ({
  Directory: class Directory {},
  File: class File {},
  Paths: { cache: "/cache" },
}));

vi.mock("../src/v2/infrastructure/connection/sharedConnectionAdapter.native", () => ({
  acquireSharedConnectionLease: transportMocks.acquireSharedConnectionLease,
}));

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");
const loopbackOrigin = `http://127.0.0.1:41234/${"a".repeat(43)}`;

describe("V2 resource transport boundary", () => {
  it("keeps resource models independent from native and transport details", () => {
    for (const path of [
      "../src/v2/application/ports/portTransport.ts",
      "../src/v2/application/ports/terminalTransport.ts",
      "../src/v2/application/preview/previewTransport.ts",
      "../src/v2/application/resources/portsResource.ts",
      "../src/v2/application/resources/previewResource.ts",
      "../src/v2/application/terminalController.ts",
    ]) {
      const source = read(path);
      expect(source).not.toContain("NativeModules");
      expect(source).not.toContain("WebSocket");
      expect(source).not.toContain("fetch(");
      expect(source).not.toContain("mintStoredSession");
      expect(source).not.toContain("companionHttpOrigin");
    }
  });

  it("routes terminal sessions through the shared authenticated connection", () => {
    const terminal = read("../src/v2/infrastructure/terminal/closedTerminalTransport.native.ts");
    expect(terminal).toContain("acquireSharedConnectionLease");
    expect(terminal).toContain('openDuplex("terminal-v2")');
    expect(terminal).not.toContain("new WebSocket");
    expect(terminal).not.toContain("fetch(");
    expect(terminal).not.toContain("mintStoredSession");
  });

  it("routes durable ports through the native device-authenticated transport", () => {
    const ports = read("../src/v2/infrastructure/ports/closedPortTransport.native.ts");
    const manager = read(
      "../android/app/src/main/java/dev/codewide/app/remote/NativePortForwardManager.kt",
    );
    const companion = read("../../companion/src/sync_v2/ports.rs");
    expect(ports).toContain('NativeModules["CodeWideNative"]');
    expect(ports).toContain("listPortForwards");
    expect(ports).toContain("upsertPortForward");
    expect(ports).toContain("CodeWidePortForwardEvent");
    expect(manager).toContain("InnerTlsTransport.client(baseClient, saved)");
    expect(manager).toContain('val suffix = "/v2/ports/$remotePort"');
    expect(manager).toContain("startGate.runIfCurrent(permit)");
    expect(companion).toContain("bridge_port(socket, stream, &mut authority).await");
    expect(companion).not.toContain("Duration::from_secs(15)");
    expect(companion).not.toContain("idle_timeout");
  });

  it("routes tunnel operations through the authenticated shared connection lease", async () => {
    transportMocks.request
      .mockResolvedValueOnce({
        bodyBase64: Buffer.from(
          JSON.stringify({ basePath: "/v2/tunnels/tunnel-a", expiresAt: 42, id: "tunnel-a" }),
        ).toString("base64"),
        status: 200,
      })
      .mockResolvedValueOnce({ bodyBase64: "", status: 204 });
    transportMocks.acquireSharedConnectionLease.mockResolvedValue({
      lease: { release: transportMocks.release, request: transportMocks.request },
    });
    const server = savedServerId("server-a");
    const transport = createClosedPortTransport();

    await expect(transport.createTunnel(server, 3000, 60)).resolves.toEqual({
      basePath: "/v2/tunnels/tunnel-a",
      expiresAt: 42,
      id: "tunnel-a",
    });
    await transport.deleteTunnel(server, "tunnel-a");

    expect(transportMocks.acquireSharedConnectionLease).toHaveBeenNthCalledWith(1, server);
    expect(transportMocks.acquireSharedConnectionLease).toHaveBeenNthCalledWith(2, server);
    expect(transportMocks.request).toHaveBeenNthCalledWith(1, "tunnels-v2", {
      operation: "tunnel.create",
      port: 3000,
      ttlSeconds: 60,
    });
    expect(transportMocks.request).toHaveBeenNthCalledWith(2, "tunnels-v2", {
      operation: "tunnel.delete",
      tunnelId: "tunnel-a",
    });
    expect(transportMocks.release).toHaveBeenCalledTimes(2);
  });

  it("routes attachment previews through the shared authenticated connection", () => {
    const previews = read("../src/v2/infrastructure/preview/closedPreviewTransport.native.ts");
    const transfers = read("../src/v2/infrastructure/preview/previewFileTransfer.native.ts");
    expect(previews).toContain("acquireSharedConnectionLease");
    expect(previews).not.toContain("new WebSocket");
    expect(previews).not.toContain("fetch(");
    expect(previews).toContain('lease.request("media-v2"');
    expect(previews).toContain('operation: streaming ? "media.streamCreate" : "media.materialize"');
    expect(previews).toContain('operation: "media.streamRead"');
    expect(previews).not.toContain("Remote attachment type cannot be streamed securely");
    expect(transfers).toContain("request.savedServerId");
  });

  it("streams media only through the pinned loopback proxy", () => {
    const previews = read("../src/v2/infrastructure/preview/closedPreviewTransport.native.ts");
    expect(previews).toContain("bridge.companionHttpOrigin(savedServerId)");
    expect(previews).toContain("bridge.mintStoredSession(savedServerId)");
    expect(previews).toContain(
      "/^http:\\/\\/127\\.0\\.0\\.1:\\d+\\/[A-Za-z0-9_-]{43}$/u",
    );
    expect(previews).toContain("headers: { Authorization: `Bearer ${session.sessionToken}` }");
  });

  it("reads documents through files-v2 and releases the shared lease", async () => {
    transportMocks.request.mockReset();
    transportMocks.release.mockClear();
    transportMocks.acquireSharedConnectionLease.mockResolvedValue({
      lease: { release: transportMocks.release, request: transportMocks.request },
    });
    transportMocks.request.mockResolvedValue({
      bodyBase64: "aGVsbG8=",
      contentType: "text/plain",
      status: 200,
    });
    const server = savedServerId("server-preview");

    await expect(
      createClosedPreviewTransport().read(server, "/v2/files/preview?path=notes.txt"),
    ).resolves.toEqual({ bodyBase64: "aGVsbG8=", contentType: "text/plain" });
    expect(transportMocks.request).toHaveBeenCalledExactlyOnceWith("files-v2", {
      head: false,
      operation: "file.preview",
      path: "notes.txt",
    });
    expect(transportMocks.release).toHaveBeenCalledTimes(1);
  });

  it("registers a private file before exposing its authenticated stream", async () => {
    transportMocks.request.mockReset();
    transportMocks.release.mockClear();
    transportMocks.acquireSharedConnectionLease.mockClear();
    transportMocks.companionHttpOrigin.mockClear();
    transportMocks.mintStoredSession.mockClear();
    transportMocks.companionHttpOrigin.mockResolvedValue(loopbackOrigin);
    transportMocks.mintStoredSession.mockResolvedValue({
      expiresAt: 42,
      sessionToken: "opaque-session",
    });
    transportMocks.acquireSharedConnectionLease.mockResolvedValue({
      lease: { release: transportMocks.release, request: transportMocks.request },
    });
    transportMocks.request.mockResolvedValue({ bodyBase64: "", status: 204 });
    const server = savedServerId("server-preview");

    await expect(
      createClosedPreviewTransport().stream(
        server,
        "/v2/files/preview?path=%2Fworkspace%2Fimage.png",
        "image",
      ),
    ).resolves.toEqual({
      headers: { Authorization: "Bearer opaque-session" },
      uri: `${loopbackOrigin}/v2/files/preview?path=%2Fworkspace%2Fimage.png`,
    });
    expect(transportMocks.acquireSharedConnectionLease).toHaveBeenCalledExactlyOnceWith(server);
    expect(transportMocks.request).toHaveBeenCalledExactlyOnceWith("files-v2", {
      head: false,
      operation: "file.preview",
      path: "/workspace/image.png",
    });
    expect(transportMocks.release).toHaveBeenCalledTimes(1);
  });

  it("mints an authenticated loopback stream for private remote images", async () => {
    transportMocks.request.mockReset();
    transportMocks.acquireSharedConnectionLease.mockClear();
    transportMocks.companionHttpOrigin.mockClear();
    transportMocks.mintStoredSession.mockClear();
    transportMocks.companionHttpOrigin.mockResolvedValue(loopbackOrigin);
    transportMocks.mintStoredSession.mockResolvedValue({
      expiresAt: 42,
      sessionToken: "opaque-session",
    });
    transportMocks.acquireSharedConnectionLease.mockResolvedValue({
      lease: { release: transportMocks.release, request: transportMocks.request },
    });
    transportMocks.request.mockResolvedValue({
      bodyBase64: Buffer.from(JSON.stringify({ expiresAt: 42, id: "media-a" })).toString("base64"),
      status: 200,
    });
    const server = savedServerId("server-preview");

    await expect(
      createClosedPreviewTransport().stream(server, "https://private.example/image.png", "image"),
    ).resolves.toEqual({
      headers: { Authorization: "Bearer opaque-session" },
      uri: `${loopbackOrigin}/v2/media/media-a`,
    });
    expect(transportMocks.request).toHaveBeenCalledExactlyOnceWith("media-v2", {
      operation: "media.materialize",
      sourceUrl: "https://private.example/image.png",
    });
    expect(transportMocks.companionHttpOrigin).toHaveBeenCalledExactlyOnceWith(server);
    expect(transportMocks.mintStoredSession).toHaveBeenCalledExactlyOnceWith(server);
  });

  it("reads a bounded remote HTTPS document through the registered asset stream", async () => {
    transportMocks.request.mockReset();
    transportMocks.release.mockClear();
    transportMocks.companionHttpOrigin.mockClear();
    transportMocks.mintStoredSession.mockClear();
    transportMocks.acquireSharedConnectionLease.mockResolvedValue({
      lease: { release: transportMocks.release, request: transportMocks.request },
    });
    transportMocks.request
      .mockResolvedValueOnce({
        bodyBase64: Buffer.from(JSON.stringify({ expiresAt: 42, id: "document-a" })).toString(
          "base64",
        ),
        contentType: "application/json",
        status: 200,
      })
      .mockResolvedValueOnce({ bodyBase64: "aGVsbG8=", contentType: "text/plain", status: 206 });
    const server = savedServerId("server-preview");

    await expect(
      createClosedPreviewTransport().read(server, "https://private.example/notes.txt"),
    ).resolves.toEqual({ bodyBase64: "aGVsbG8=", contentType: "text/plain" });
    expect(transportMocks.request).toHaveBeenNthCalledWith(1, "media-v2", {
      operation: "media.streamCreate",
      sourceUrl: "https://private.example/notes.txt",
    });
    expect(transportMocks.request).toHaveBeenNthCalledWith(2, "media-v2", {
      head: false,
      id: "document-a",
      limit: 2 * 1024 * 1024 + 1,
      offset: 0,
      operation: "media.streamRead",
    });
    expect(transportMocks.release).toHaveBeenCalledTimes(1);
    expect(transportMocks.companionHttpOrigin).not.toHaveBeenCalled();
    expect(transportMocks.mintStoredSession).not.toHaveBeenCalled();
  });

  it("streams generic HTTPS assets through the authenticated loopback proxy", async () => {
    transportMocks.request.mockReset();
    transportMocks.release.mockClear();
    transportMocks.companionHttpOrigin.mockResolvedValue(loopbackOrigin);
    transportMocks.mintStoredSession.mockResolvedValue({
      expiresAt: 42,
      sessionToken: "opaque-session",
    });
    transportMocks.acquireSharedConnectionLease.mockResolvedValue({
      lease: { release: transportMocks.release, request: transportMocks.request },
    });
    transportMocks.request.mockResolvedValue({
      bodyBase64: Buffer.from(JSON.stringify({ expiresAt: 42, id: "asset-a" })).toString("base64"),
      contentType: "application/json",
      status: 200,
    });
    const server = savedServerId("server-preview");

    await expect(
      createClosedPreviewTransport().stream(server, "https://private.example/archive.zip", "web"),
    ).resolves.toEqual({
      headers: { Authorization: "Bearer opaque-session" },
      uri: `${loopbackOrigin}/v2/media/streams/asset-a`,
    });
    expect(transportMocks.request).toHaveBeenCalledExactlyOnceWith("media-v2", {
      operation: "media.streamCreate",
      sourceUrl: "https://private.example/archive.zip",
    });
    expect(transportMocks.release).toHaveBeenCalledTimes(1);
  });
});
