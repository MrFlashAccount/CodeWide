import { randomBytes } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { pipeline } from "node:stream/promises";

import { WebSocket, WebSocketServer } from "ws";

import { tokenMatches } from "./token.js";

const MIN_TTL_SECONDS = 30;
const MAX_TTL_SECONDS = 60 * 60;
const MAX_CONTROL_BODY_BYTES = 8 * 1024;
const MAX_WEBSOCKET_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_WEBSOCKET_BUFFERED_BYTES = 4 * 1024 * 1024;
const HOP_BY_HOP_HEADERS = new Set([
  "authorization",
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

type Tunnel = {
  id: string;
  port: number;
  expiresAt: number;
  browserToken: string;
};

export class LocalhostTunnelService {
  readonly #token: string;
  readonly #authorize: (authorization: string | undefined) => boolean;
  readonly #tunnels = new Map<string, Tunnel>();
  readonly #webSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_WEBSOCKET_FRAME_BYTES,
  });

  constructor(capabilityToken: string, authorize?: (authorization: string | undefined) => boolean) {
    this.#token = capabilityToken;
    this.#authorize = authorize ?? ((authorization) => tokenMatches(this.#token, authorization));
  }

  async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith("/v1/tunnels")) return false;
    this.#purgeExpired();

    if (requestUrl.pathname === "/v1/tunnels" && request.method === "POST") {
      if (!this.#bearerAuthorized(request)) {
        json(response, 401, { error: "unauthorized" });
        return true;
      }
      const body = await readJson(request);
      const port = typeof body.port === "number" ? body.port : Number.NaN;
      const ttlSeconds = body.ttlSeconds === undefined ? 300 : body.ttlSeconds;
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        json(response, 400, { error: "invalid_port" });
        return true;
      }
      if (typeof ttlSeconds !== "number" || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS) {
        json(response, 400, { error: "invalid_ttl" });
        return true;
      }
      const id = randomBytes(16).toString("base64url");
      const tunnel = { id, port, expiresAt: Date.now() + ttlSeconds * 1_000, browserToken: randomBytes(32).toString("base64url") };
      this.#tunnels.set(id, tunnel);
      json(response, 201, { id, expiresAt: tunnel.expiresAt, basePath: `/v1/tunnels/${id}/` });
      return true;
    }

    const match = /^\/v1\/tunnels\/([^/]+)(\/.*)?$/.exec(requestUrl.pathname);
    if (match === null) {
      json(response, 404, { error: "tunnel_not_found" });
      return true;
    }
    const id = match[1] ?? "";
    if (request.method === "DELETE" && (match[2] === undefined || match[2] === "")) {
      if (!this.#bearerAuthorized(request)) {
        json(response, 401, { error: "unauthorized" });
        return true;
      }
      const removed = this.#tunnels.delete(id);
      json(response, removed ? 200 : 404, { revoked: removed });
      return true;
    }
    const tunnel = this.#tunnel(id);
    if (tunnel === null) {
      json(response, 404, { error: "tunnel_not_found" });
      return true;
    }
    const browserAuthorized = this.#browserAuthorized(request, tunnel);
    const bearerAuthorized = this.#bearerAuthorized(request);
    if (!browserAuthorized && !bearerAuthorized) {
      json(response, 401, { error: "unauthorized" });
      return true;
    }
    const targetPath = `${match[2] ?? "/"}${requestUrl.search}`;
    await forwardHttp(request, response, tunnel.port, targetPath, tunnel, bearerAuthorized);
    return true;
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const match = /^\/v1\/tunnels\/([^/]+)(\/.*)?$/.exec(requestUrl.pathname);
    if (match === null) return false;
    this.#purgeExpired();
    const tunnel = this.#tunnel(match[1] ?? "");
    if (tunnel === null) {
      rejectUpgrade(socket, 404, "Not Found");
      return true;
    }
    if (!this.#bearerAuthorized(request) && !this.#browserAuthorized(request, tunnel)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return true;
    }
    const targetPath = `${match[2] ?? "/"}${requestUrl.search}`;
    this.#webSocketServer.handleUpgrade(request, socket, head, (client) => {
      const upstream = new WebSocket(`ws://127.0.0.1:${tunnel.port}${targetPath}`, {
        headers: filteredHeaders(request.headers, tunnel),
        perMessageDeflate: false,
      });
      const pending: Array<{ data: Buffer; binary: boolean }> = [];
      let pendingBytes = 0;
      let closed = false;
      const closeBoth = () => {
        if (closed) return;
        closed = true;
        if (client.readyState === WebSocket.OPEN) client.close();
        if (upstream.readyState === WebSocket.OPEN) upstream.close();
      };
      client.on("message", (data, binary) => {
        const buffer = Buffer.from(data as ArrayBuffer);
        if (upstream.readyState === WebSocket.CONNECTING) {
          pendingBytes += buffer.byteLength;
          if (pendingBytes > MAX_WEBSOCKET_BUFFERED_BYTES) {
            if (client.readyState === WebSocket.OPEN) client.close(1013, "localhost_backpressure");
            upstream.terminate();
            return;
          }
          pending.push({ data: buffer, binary });
        } else if (upstream.readyState === WebSocket.OPEN) {
          if (upstream.bufferedAmount > MAX_WEBSOCKET_BUFFERED_BYTES) {
            closeBoth();
            return;
          }
          upstream.send(buffer, { binary });
        }
      });
      upstream.once("open", () => {
        for (const message of pending) upstream.send(message.data, { binary: message.binary });
        pending.length = 0;
        pendingBytes = 0;
      });
      upstream.on("message", (data, binary) => {
        if (client.bufferedAmount > MAX_WEBSOCKET_BUFFERED_BYTES) {
          closeBoth();
          return;
        }
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
      });
      client.once("close", closeBoth);
      client.once("error", closeBoth);
      upstream.once("close", closeBoth);
      upstream.once("error", () => {
        if (client.readyState === WebSocket.OPEN) client.close(1011, "localhost_unavailable");
      });
    });
    return true;
  }

  close(): void {
    this.#tunnels.clear();
    this.#webSocketServer.close();
  }

  #bearerAuthorized(request: IncomingMessage): boolean {
    return request.headers.origin === undefined && this.#authorize(request.headers.authorization);
  }

  #browserAuthorized(request: IncomingMessage, tunnel: Tunnel): boolean {
    const cookies = parseCookies(request.headers.cookie);
    const browserToken = cookies.get(cookieName(tunnel.id));
    if (!tokenMatches(tunnel.browserToken, browserToken === undefined ? undefined : `Bearer ${browserToken}`)) return false;
    const origin = request.headers.origin;
    if (origin === undefined) return true;
    try {
      return new URL(origin).host === request.headers.host;
    } catch {
      return false;
    }
  }

  #tunnel(id: string): Tunnel | null {
    const tunnel = this.#tunnels.get(id);
    if (tunnel === undefined || tunnel.expiresAt <= Date.now()) {
      this.#tunnels.delete(id);
      return null;
    }
    return tunnel;
  }

  #purgeExpired(): void {
    const now = Date.now();
    for (const [id, tunnel] of this.#tunnels) if (tunnel.expiresAt <= now) this.#tunnels.delete(id);
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_CONTROL_BODY_BYTES) throw new Error("control_body_too_large");
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_json");
  return parsed as Record<string, unknown>;
}

async function forwardHttp(
  request: IncomingMessage,
  response: ServerResponse,
  port: number,
  targetPath: string,
  tunnel: Tunnel,
  setBrowserCookie: boolean,
): Promise<void> {
  const upstream = httpRequest({
    host: "127.0.0.1",
    port,
    path: targetPath,
    method: request.method,
    headers: filteredHeaders(request.headers, tunnel),
  });
  const upstreamResponse = new Promise<IncomingMessage>((resolve, reject) => {
    upstream.once("response", resolve);
    upstream.once("error", reject);
  });
  try {
    const [received] = await Promise.all([upstreamResponse, pipeline(request, upstream)]);
    response.writeHead(received.statusCode ?? 502, {
      ...filteredHeaders(received.headers),
      ...(setBrowserCookie ? { "set-cookie": browserCookie(request, tunnel) } : {}),
    });
    await pipeline(received, response);
  } catch (error) {
    upstream.destroy();
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }
    json(response, 502, { error: "localhost_unavailable" });
  }
}

function filteredHeaders(headers: IncomingHttpHeaders, tunnel?: Tunnel): IncomingHttpHeaders {
  const filtered = Object.fromEntries(
    Object.entries(headers).filter(([name]) => {
      const normalized = name.toLowerCase();
      return !HOP_BY_HOP_HEADERS.has(normalized) && !normalized.startsWith("sec-websocket-");
    }),
  );
  if (tunnel !== undefined && typeof filtered.cookie === "string") {
    const kept = filtered.cookie.split(";").map((part) => part.trim()).filter((part) => !part.startsWith(`${cookieName(tunnel.id)}=`));
    if (kept.length === 0) delete filtered.cookie;
    else filtered.cookie = kept.join("; ");
  }
  return filtered;
}

function cookieName(tunnelId: string): string {
  return `codex_tunnel_${tunnelId}`;
}

function parseCookies(header: string | undefined): Map<string, string> {
  const values = new Map<string, string>();
  for (const pair of header?.split(";") ?? []) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    values.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  return values;
}

function browserCookie(request: IncomingMessage, tunnel: Tunnel): string {
  const secure = request.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `${cookieName(tunnel.id)}=${tunnel.browserToken}; Path=/v1/tunnels/${tunnel.id}/; HttpOnly; SameSite=Strict${secure}; Max-Age=${Math.max(1, Math.ceil((tunnel.expiresAt - Date.now()) / 1000))}`;
}

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}

function rejectUpgrade(socket: Duplex, statusCode: number, statusText: string): void {
  socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
