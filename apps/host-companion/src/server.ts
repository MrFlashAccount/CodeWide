import {
  createServer,
  request as createHttpRequest,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { mkdir } from "node:fs/promises";
import { connect as connectUnix } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer } from "ws";

import { RpcPolicySession } from "./rpc-policy.js";
import { ScopedFileService } from "./scoped-files.js";
import { LocalhostTunnelService } from "./localhost-tunnels.js";
import { LocalPortForwardService } from "./local-port-forwards.js";
import { PortDiscoveryService } from "./port-discovery.js";
import { hasScope } from "./capabilities.js";
import { MediaProxyService } from "./media-proxy.js";
import { ReplayJournal } from "./replay-journal.js";
import { AppServerSyncHub } from "./sync-hub.js";
import { DeviceRegistry } from "./device-registry.js";
import { HostQueueStore } from "./host-queue.js";
import { prepareRemoteFileInputs } from "./remote-inputs.js";
import { DictationService, type DictationServiceOptions } from "./dictation.js";
import { BoundedOutboundQueue } from "./outbound-queue.js";
import { CompositeLocalRpcHandler, LegacyHistoryCache } from "./legacy-history-cache.js";
import { PrivateContentService } from "./private-content.js";
import { ContentProjector } from "./content-projection.js";

const APP_SERVER_PATH = "/v1/app-server";
const SYNC_PATH = "/v1/sync";
const MAX_RPC_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const MAX_OUTBOUND_QUEUE_BYTES = 64 * 1024 * 1024;
const BUILD_SHELF_REQUEST_HEADERS = [
  "accept",
  "if-none-match",
  "range",
  "expo-current-update-id",
  "expo-platform",
  "expo-protocol-version",
  "expo-runtime-version",
] as const;
const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
export const PUBLIC_BUILD_SHELF_PATHS = [
  "/",
  "/api/builds",
  "/api/updates",
  "/api/updates/assets/*",
  "/latest.apk",
  "/CodeWide.apk",
  "/download/*",
] as const;

export type HostCompanionOptions = {
  host: string;
  port: number;
  capabilityToken: string;
  appServerSocketPath?: string;
  connectUpstream?: () => WebSocket;
  fileRoots?: Record<string, string>;
  previewRoots?: string[];
  previewPathMappings?: Record<string, string>;
  maxTransferBytes?: number;
  replayJournalPath?: string;
  maxReplayEntries?: number;
  deviceRegistryPath?: string;
  queuePath?: string;
  sessionTtlMs?: number;
  allowNonLoopback?: boolean;
  dictationOptions?: DictationServiceOptions;
  buildShelfOrigin?: string;
};

export type RunningHostCompanion = {
  server: HttpServer;
  address(): { host: string; port: number };
  close(): Promise<void>;
  createPairing(): Promise<{ pairingToken: string; expiresAt: number }>;
};

export async function startHostCompanion(options: HostCompanionOptions): Promise<RunningHostCompanion> {
  if (!isLoopbackHost(options.host) && options.allowNonLoopback !== true) {
    throw new Error("Non-loopback bind requires an explicit allowNonLoopback opt-in; prefer a TLS/private-network reverse proxy to loopback");
  }
  const buildShelfOrigin = parseLocalBuildShelfOrigin(options.buildShelfOrigin);
  const stateDirectory = path.dirname(options.deviceRegistryPath ?? path.join(homedir(), ".codewide", "devices.json"));
  const attachmentRoot = path.join(stateDirectory, "attachments");
  await mkdir(attachmentRoot, { recursive: true, mode: 0o700 });
  const devices = await DeviceRegistry.open(options.capabilityToken, options.deviceRegistryPath, options.sessionTtlMs);
  const files = await ScopedFileService.create({
    capabilityToken: options.capabilityToken,
    authorize: (authorization, scope) => devices.authorizeSession(authorization, scope),
    roots: { ...options.fileRoots, attachments: attachmentRoot },
    ...(options.previewRoots === undefined ? {} : { previewRoots: options.previewRoots }),
    ...(options.previewPathMappings === undefined ? {} : { previewPathMappings: options.previewPathMappings }),
    ...(options.maxTransferBytes === undefined ? {} : { maxTransferBytes: options.maxTransferBytes }),
    previewRegistryPath: path.join(stateDirectory, "preview-files.json"),
  });
  const tunnels = new LocalhostTunnelService(options.capabilityToken, (authorization) => devices.authorizeSession(authorization, "localhost.forward"));
  const portForwards = new LocalPortForwardService((authorization) => {
    const context = devices.authorizationContext(authorization);
    if (context === null || context.kind === "device" || !hasScope(context, "localhost.forward")) return null;
    return {
      deviceId: context.deviceId,
      expiresAt: context.kind === "session" ? context.expiresAt : null,
    };
  });
  const portDiscovery = new PortDiscoveryService(
    (authorization) => devices.authorizeSession(authorization, "localhost.forward"),
    [options.port],
  );
  const media = new MediaProxyService((authorization, scope) => devices.authorizeSession(authorization, scope));
  const content = new PrivateContentService(path.join(stateDirectory, "content-cache"), (authorization, scope) => devices.authorizeSession(authorization, scope));
  const contentProjector = new ContentProjector(content);
  const journal = await ReplayJournal.open({
    ...(options.replayJournalPath === undefined ? {} : { filePath: options.replayJournalPath }),
    ...(options.maxReplayEntries === undefined ? {} : { maxEntries: options.maxReplayEntries }),
  });
  journal.forEachPayload((payload) => {
    if (typeof payload.method === "string") files.registerPreviewFilesFromAppServer(payload.method, payload.params);
  });
  const queue = await HostQueueStore.open(options.queuePath);
  const connectUpstream = options.connectUpstream ?? (() => connectDaemon(options.appServerSocketPath));
  const dictation = new DictationService(options.dictationOptions);
  const history = new LegacyHistoryCache({
    connectUpstream,
    cacheDirectory: path.join(stateDirectory, "history-cache"),
    contentProjector,
  });
  // Reapply the durable event tail before serving resource reads. Completed
  // turns are immutable and idempotent in the append-only resource index, so
  // this closes the restart window between journal append and index persist.
  journal.forEachPayload((payload) => {
    if (typeof payload.method === "string") history.observe(payload.method, payload.params);
  });
  const localRpc = new CompositeLocalRpcHandler(dictation, history);
  const syncHub = new AppServerSyncHub(
    connectUpstream,
    journal,
    queue,
    async (method, params) => await prepareRemoteFileInputs(method, params, async (rootId, relativePath) => await files.resolveInputFile(rootId, relativePath)),
    (method, payload, requestParams) => {
      files.registerPreviewFilesFromAppServer(method, payload, requestParams);
      history.observe(method, payload);
    },
    localRpc,
    contentProjector,
  );
  const sockets = new Set<Duplex>();
  const webSockets = new Set<WebSocket>();
  const deviceWebSockets = new Map<WebSocket, string>();
  const upstreams = new Set<WebSocket>();
  let closed = false;
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_RPC_FRAME_BYTES,
    perMessageDeflate: false,
  });
  const syncWebSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_RPC_FRAME_BYTES,
    perMessageDeflate: false,
  });
  const unsubscribeAuthorizationChanges = devices.onAuthorizationChange((deviceId, reason) => {
    portForwards.closeDevice(deviceId);
    for (const [socket, socketDeviceId] of deviceWebSockets) {
      if (socketDeviceId === deviceId) socket.close(4003, reason);
    }
  });
  const server = createServer((request, response) => {
    if (request.url === "/healthz" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}\n');
      return;
    }
    if (buildShelfOrigin !== undefined && proxyBuildShelfRequest(request, response, buildShelfOrigin)) return;
    void devices.handle(request, response).then(async (handled) => handled || files.handle(request, response)).then(async (handled) => handled || media.handle(request, response)).then(async (handled) => handled || content.handle(request, response)).then(async (handled) => handled || portDiscovery.handle(request, response)).then(async (handled) => handled || tunnels.handleHttp(request, response)).then((handled) => {
      if (!handled && !response.headersSent) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end('{"error":"not_found"}\n');
      }
    }).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end('{"error":"internal_error"}\n');
    });
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket, head) => {
    if (portForwards.handleUpgrade(request, socket, head)) return;
    if (tunnels.handleUpgrade(request, socket, head)) return;
    const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
    if (!isAuthorizedUpgrade(request, devices, requestPath)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (requestPath === SYNC_PATH) {
      syncWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        syncWebSocketServer.emit("connection", webSocket, request);
      });
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });
  syncWebSocketServer.on("connection", (client, request) => {
    webSockets.add(client);
    const authorization = devices.authorizationContext(request.headers.authorization);
    if (authorization === null || authorization.kind === "device") {
      client.close(4003, "authorization_expired");
      return;
    }
    if (authorization.kind === "session") deviceWebSockets.set(client, authorization.deviceId);
    const expiryTimer = authorization.kind === "session"
      ? setTimeout(() => client.close(4003, "session_expired"), Math.max(1, authorization.expiresAt - Date.now()))
      : undefined;
    expiryTimer?.unref();
    client.once("close", () => {
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      webSockets.delete(client);
      deviceWebSockets.delete(client);
    });
    syncHub.attach(client, authorization);
  });
  webSocketServer.on("connection", (client, request) => {
    webSockets.add(client);
    const deviceId = devices.deviceIdForAuthorization(request.headers.authorization);
    if (deviceId !== null) deviceWebSockets.set(client, deviceId);
    const upstream = connectUpstream();
    const policy = new RpcPolicySession();
    upstreams.add(upstream);
    const pending: string[] = [];
    let pendingBytes = 0;

    const closePair = (code: number, reason: string) => {
      if (client.readyState === WebSocket.OPEN) client.close(code, reason);
      if (upstream.readyState === WebSocket.OPEN) upstream.close(1000, reason);
    };
    const outbound = new BoundedOutboundQueue({
      socket: client,
      openReadyState: WebSocket.OPEN,
      maxFrameBytes: MAX_RPC_FRAME_BYTES,
      maxQueuedBytes: MAX_OUTBOUND_QUEUE_BYTES,
      close: closePair,
    });
    client.once("close", () => {
      outbound.dispose();
      webSockets.delete(client);
      deviceWebSockets.delete(client);
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close(1000, "client_closed");
      }
    });
    upstream.once("close", () => {
      upstreams.delete(upstream);
      if (client.readyState === WebSocket.OPEN) client.close(1012, "app_server_disconnected");
    });
    upstream.once("error", () => closePair(1011, "app_server_connect_failed"));
    client.once("error", () => {
      if (upstream.readyState === WebSocket.OPEN) upstream.close(1000, "client_error");
    });

    client.on("message", (data, isBinary) => {
      if (isBinary) {
        closePair(1003, "text_frames_only");
        return;
      }
      const frame = data.toString("utf8");
      const frameBytes = Buffer.byteLength(frame);
      if (frameBytes > MAX_RPC_FRAME_BYTES) {
        closePair(1009, "frame_too_large");
        return;
      }
      const decision = policy.evaluate(frame);
      if (decision.action === "close") {
        closePair(decision.code, decision.reason);
        return;
      }
      if (decision.action === "reject") {
        outbound.send(JSON.stringify(decision.response));
        return;
      }
      if (upstream.readyState === WebSocket.CONNECTING) {
        pendingBytes += frameBytes;
        if (pendingBytes > MAX_BUFFERED_BYTES) {
          closePair(1013, "upstream_backpressure");
          return;
        }
        pending.push(frame);
        return;
      }
      if (upstream.readyState !== WebSocket.OPEN || upstream.bufferedAmount > MAX_BUFFERED_BYTES) {
        closePair(1013, "upstream_unavailable");
        return;
      }
      upstream.send(frame);
    });
    upstream.once("open", () => {
      for (const frame of pending) upstream.send(frame);
      pending.length = 0;
      pendingBytes = 0;
    });
    upstream.on("message", (data, isBinary) => {
      if (isBinary) {
        closePair(1011, "unexpected_binary_from_app_server");
        return;
      }
      if (client.readyState !== WebSocket.OPEN) return;
      outbound.send(data.toString("utf8"));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    server,
    address() {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Host companion is not listening on TCP");
      return { host: address.address, port: address.port };
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const webSocket of webSockets) webSocket.close(1001, "server_shutdown");
      for (const upstream of upstreams) upstream.close(1001, "server_shutdown");
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      webSocketServer.close();
      syncWebSocketServer.close();
      tunnels.close();
      portForwards.close();
      media.close();
      unsubscribeAuthorizationChanges();
      await syncHub.close();
      await content.close();
      await files.close();
      await devices.close();
    },
    async createPairing() {
      return await devices.createPairing();
    },
  };
}

function parseLocalBuildShelfOrigin(value: string | undefined): URL | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const origin = new URL(value);
  if (origin.protocol !== "http:" || !isLoopbackHost(origin.hostname)) {
    throw new Error("Build shelf origin must be an http loopback URL");
  }
  return origin;
}

function proxyBuildShelfRequest(request: IncomingMessage, response: ServerResponse, origin: URL): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const incomingUrl = new URL(request.url ?? "/", "http://localhost");
  if (!isPublicBuildShelfPath(incomingUrl.pathname)) return false;
  const requestUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, origin);

  const headers: Record<string, string | string[]> = {};
  for (const name of BUILD_SHELF_REQUEST_HEADERS) {
    const value = request.headers[name];
    if (value !== undefined) headers[name] = value;
  }

  const upstream = createHttpRequest(requestUrl, { method: request.method, headers }, (upstreamResponse) => {
    const responseHeaders: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(upstreamResponse.headers)) {
      if (value !== undefined && !HOP_BY_HOP_RESPONSE_HEADERS.has(name)) responseHeaders[name] = value;
    }
    response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
    upstreamResponse.pipe(response);
  });
  upstream.setTimeout(15_000, () => upstream.destroy(new Error("Build shelf timed out")));
  upstream.once("error", () => {
    if (response.writableEnded) return;
    if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
    response.end('{"error":"build_shelf_unavailable"}\n');
  });
  request.once("aborted", () => upstream.destroy());
  upstream.end();
  return true;
}

function isPublicBuildShelfPath(pathname: string): boolean {
  return PUBLIC_BUILD_SHELF_PATHS.some((pattern) => pattern.endsWith("*")
    ? pathname.startsWith(pattern.slice(0, -1))
    : pathname === pattern);
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function connectDaemon(explicitSocketPath?: string): WebSocket {
  const socketPath =
    explicitSocketPath ??
    path.join(process.env.CODEX_HOME ?? path.join(homedir(), ".codex"), "app-server-control", "app-server-control.sock");
  return new WebSocket("ws://localhost/", {
    perMessageDeflate: false,
    createConnection: () => connectUnix(socketPath),
  });
}

function isAuthorizedUpgrade(
  request: IncomingMessage,
  devices: DeviceRegistry,
  requestPath: string,
): boolean {
  if ((requestPath !== APP_SERVER_PATH && requestPath !== SYNC_PATH) || request.method !== "GET") return false;
  if (request.headers.origin !== undefined) return false;
  if (requestPath === APP_SERVER_PATH) return devices.adminAuthorize(request.headers.authorization);
  return devices.authorizeSession(request.headers.authorization, "threads.read");
}
