import { connect, type Socket } from "node:net";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer } from "ws";

const ROUTE = /^\/v1\/port-forwards\/([1-9][0-9]{0,4})$/u;
const CONNECT_TIMEOUT_MS = 10_000;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

type Authorization = { deviceId: string | null; expiresAt: number | null };

/**
 * Transparent, native-client-only TCP bridge to an explicit host loopback port.
 *
 * One WebSocket represents one TCP connection. Keeping the stream opaque here
 * preserves HTTP keep-alive, WebSocket upgrades, absolute paths and dev-server
 * HMR without teaching the companion about any application protocol.
 */
export class LocalPortForwardService {
  readonly #authorize: (authorization: string | undefined) => Authorization | null;
  readonly #webSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_FRAME_BYTES,
  });
  readonly #clients = new Map<WebSocket, { target: Socket; deviceId: string | null }>();

  constructor(authorize: (authorization: string | undefined) => Authorization | null) {
    this.#authorize = authorize;
  }

  handleUpgrade(request: IncomingMessage, downstream: Duplex, head: Buffer): boolean {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const match = ROUTE.exec(requestUrl.pathname);
    if (match === null) return false;
    if (request.headers.origin !== undefined) {
      rejectUpgrade(downstream, 401, "Unauthorized");
      return true;
    }
    const authorization = this.#authorize(request.headers.authorization);
    if (authorization === null) {
      rejectUpgrade(downstream, 401, "Unauthorized");
      return true;
    }
    const port = Number(match[1]);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      rejectUpgrade(downstream, 400, "Bad Request");
      return true;
    }

    const target = connect({ host: "127.0.0.1", port });
    let upgraded = false;
    const abortBeforeUpgrade = () => {
      if (!upgraded) target.destroy();
    };
    downstream.once("close", abortBeforeUpgrade);
    const timeout = setTimeout(() => {
      target.destroy();
      rejectUpgrade(downstream, 504, "Gateway Timeout");
    }, CONNECT_TIMEOUT_MS);
    timeout.unref();
    target.once("error", () => {
      if (upgraded) return;
      clearTimeout(timeout);
      rejectUpgrade(downstream, 502, "Bad Gateway");
    });
    target.once("connect", () => {
      clearTimeout(timeout);
      upgraded = true;
      downstream.removeListener("close", abortBeforeUpgrade);
      this.#webSocketServer.handleUpgrade(request, downstream, head, (client) => {
    this.#attach(client, target, authorization);
      });
    });
    return true;
  }

  closeDevice(deviceId: string): void {
    for (const [client, state] of this.#clients) {
      if (state.deviceId === deviceId) client.close(4003, "device_authorization_changed");
    }
  }

  close(): void {
    for (const [client, state] of this.#clients) {
      state.target.destroy();
      client.terminate();
    }
    this.#clients.clear();
    this.#webSocketServer.close();
  }

  #attach(client: WebSocket, target: Socket, authorization: Authorization): void {
    this.#clients.set(client, { target, deviceId: authorization.deviceId });
    let closed = false;
    let expiryTimer: NodeJS.Timeout | undefined;
    let phoneDrainTimer: NodeJS.Timeout | undefined;
    let pendingPhoneChunk: Buffer | null = null;
    const close = (code = 1000, reason = "port_forward_closed") => {
      if (closed) return;
      closed = true;
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      if (phoneDrainTimer !== undefined) clearTimeout(phoneDrainTimer);
      this.#clients.delete(client);
      target.destroy();
      if (client.readyState === WebSocket.OPEN) client.close(code, reason);
      else if (client.readyState === WebSocket.CONNECTING) client.terminate();
    };
    if (authorization.expiresAt !== null) {
      expiryTimer = setTimeout(
        () => close(4003, "session_expired"),
        Math.max(1, authorization.expiresAt - Date.now()),
      );
      expiryTimer.unref();
    }

    const flushPhoneChunk = () => {
      phoneDrainTimer = undefined;
      if (closed || pendingPhoneChunk === null || client.readyState !== WebSocket.OPEN) return;
      if (client.bufferedAmount + pendingPhoneChunk.byteLength > MAX_BUFFERED_BYTES) {
        phoneDrainTimer = setTimeout(flushPhoneChunk, 10);
        phoneDrainTimer.unref();
        return;
      }
      const chunk = pendingPhoneChunk;
      pendingPhoneChunk = null;
      client.send(chunk, { binary: true });
      target.resume();
    };
    target.on("data", (chunk: Buffer) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (client.bufferedAmount + chunk.byteLength > MAX_BUFFERED_BYTES) {
        pendingPhoneChunk = chunk;
        target.pause();
        if (phoneDrainTimer === undefined) {
          phoneDrainTimer = setTimeout(flushPhoneChunk, 10);
          phoneDrainTimer.unref();
        }
        return;
      }
      client.send(chunk, { binary: true });
    });
    target.once("end", () => close());
    target.once("close", () => close());
    target.once("error", () => close(1011, "localhost_unavailable"));

    client.on("message", (data, binary) => {
      if (!binary) {
        close(1003, "binary_frames_required");
        return;
      }
      const chunk = Buffer.from(data as ArrayBuffer);
      if (chunk.byteLength > MAX_FRAME_BYTES || target.writableLength > MAX_BUFFERED_BYTES) {
        close(1013, "host_backpressure");
        return;
      }
      if (!target.write(chunk)) {
        client.pause();
        target.once("drain", () => {
          if (!closed) client.resume();
        });
      }
    });
    client.once("close", () => close());
    client.once("error", () => close(1011, "phone_connection_failed"));
  }
}

function rejectUpgrade(socket: Duplex, statusCode: number, statusText: string): void {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
