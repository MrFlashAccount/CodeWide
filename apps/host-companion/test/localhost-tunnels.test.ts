import { createServer, type Server } from "node:http";

import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { startHostCompanion, type RunningHostCompanion } from "../src/index.js";

describe("localhost tunnels", () => {
  let companion: RunningHostCompanion | undefined;
  let targetServer: Server | undefined;
  let targetWebSockets: WebSocketServer | undefined;

  afterEach(async () => {
    await companion?.close();
    companion = undefined;
    targetWebSockets?.clients.forEach((client) => client.terminate());
    targetWebSockets?.close();
    targetWebSockets = undefined;
    const currentTarget = targetServer;
    targetServer = undefined;
    await new Promise<void>((resolve, reject) => {
      if (currentTarget === undefined) resolve();
      else currentTarget.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("proxies explicit loopback HTTP and WebSocket targets until revoked", async () => {
    targetServer = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/plain", "x-target": "loopback" });
      response.end(`target:${request.url}`);
    });
    targetWebSockets = new WebSocketServer({ server: targetServer });
    targetWebSockets.on("connection", (socket) => socket.on("message", (data) => socket.send(`echo:${data.toString()}`)));
    await new Promise<void>((resolve, reject) => {
      targetServer?.once("error", reject);
      targetServer?.listen(0, "127.0.0.1", resolve);
    });
    const targetAddress = targetServer.address();
    if (targetAddress === null || typeof targetAddress === "string") throw new Error("Unexpected target address");

    const token = "d".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token });
    const { port } = companion.address();
    const base = `http://127.0.0.1:${port}`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const created = await fetch(`${base}/v1/tunnels`, {
      method: "POST",
      headers,
      body: JSON.stringify({ port: targetAddress.port, ttlSeconds: 30 }),
    });
    expect(created.status).toBe(201);
    const tunnel = await created.json() as { id: string };

    const proxied = await fetch(`${base}/v1/tunnels/${tunnel.id}/hello?x=1`, { headers });
    expect(proxied.status).toBe(200);
    expect(proxied.headers.get("x-target")).toBe("loopback");
    expect(await proxied.text()).toBe("target:/hello?x=1");
    const browserCookie = proxied.headers.get("set-cookie")?.split(";")[0];
    expect(browserCookie).toMatch(/^codex_tunnel_/);

    const browserSubresource = await fetch(`${base}/v1/tunnels/${tunnel.id}/asset.js`, {
      headers: { cookie: browserCookie ?? "" },
    });
    expect(browserSubresource.status).toBe(200);
    expect(await browserSubresource.text()).toBe("target:/asset.js");

    const crossOrigin = await fetch(`${base}/v1/tunnels/${tunnel.id}/asset.js`, {
      headers: { cookie: browserCookie ?? "", origin: "https://evil.invalid" },
    });
    expect(crossOrigin.status).toBe(401);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/tunnels/${tunnel.id}/hmr`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const echoed = new Promise<string>((resolve) => socket.once("message", (data) => resolve(data.toString())));
    socket.send("ping");
    await expect(echoed).resolves.toBe("echo:ping");
    socket.close();

    const browserSocket = new WebSocket(`ws://127.0.0.1:${port}/v1/tunnels/${tunnel.id}/hmr`, {
      headers: { cookie: browserCookie ?? "", origin: `http://127.0.0.1:${port}` },
    });
    await new Promise<void>((resolve, reject) => {
      browserSocket.once("open", resolve);
      browserSocket.once("error", reject);
    });
    const browserEcho = new Promise<string>((resolve) => browserSocket.once("message", (data) => resolve(data.toString())));
    browserSocket.send("browser-ping");
    await expect(browserEcho).resolves.toBe("echo:browser-ping");
    browserSocket.close();

    const revoked = await fetch(`${base}/v1/tunnels/${tunnel.id}`, { method: "DELETE", headers });
    expect(revoked.status).toBe(200);
    const afterRevoke = await fetch(`${base}/v1/tunnels/${tunnel.id}/hello`, { headers });
    expect(afterRevoke.status).toBe(404);
  });

  it("rejects implicit, invalid and unauthenticated tunnel creation", async () => {
    const token = "e".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token });
    const { port } = companion.address();
    const base = `http://127.0.0.1:${port}`;
    const missingAuth = await fetch(`${base}/v1/tunnels`, { method: "POST", body: "{}" });
    expect(missingAuth.status).toBe(401);
    const invalid = await fetch(`${base}/v1/tunnels`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ port: 0, ttlSeconds: 1 }),
    });
    expect(invalid.status).toBe(400);
  });

  it("keeps the companion alive when a tunnel target is unavailable", async () => {
    const unavailableTarget = createServer();
    await new Promise<void>((resolve, reject) => {
      unavailableTarget.once("error", reject);
      unavailableTarget.listen(0, "127.0.0.1", resolve);
    });
    const unavailableAddress = unavailableTarget.address();
    if (unavailableAddress === null || typeof unavailableAddress === "string") throw new Error("Unexpected target address");
    await new Promise<void>((resolve, reject) => unavailableTarget.close((error) => error ? reject(error) : resolve()));

    const token = "u".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token });
    const base = `http://127.0.0.1:${companion.address().port}`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const created = await fetch(`${base}/v1/tunnels`, {
      method: "POST",
      headers,
      body: JSON.stringify({ port: unavailableAddress.port, ttlSeconds: 30 }),
    });
    const tunnel = await created.json() as { id: string };

    const proxied = await fetch(`${base}/v1/tunnels/${tunnel.id}/` , { headers });
    expect(proxied.status).toBe(502);
    await expect(proxied.json()).resolves.toEqual({ error: "localhost_unavailable" });

    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
  });

  it("closes a tunnel client whose pre-connect WebSocket queue exceeds its bound", async () => {
    const stalledSockets = new Set<import("node:stream").Duplex>();
    targetServer = createServer();
    targetServer.on("upgrade", (_request, socket) => {
      // Deliberately never complete the target WebSocket handshake.
      stalledSockets.add(socket);
      socket.once("close", () => stalledSockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      targetServer?.once("error", reject);
      targetServer?.listen(0, "127.0.0.1", resolve);
    });
    const targetAddress = targetServer.address();
    if (targetAddress === null || typeof targetAddress === "string") throw new Error("Unexpected target address");
    const token = "q".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token });
    const base = `http://127.0.0.1:${companion.address().port}`;
    const created = await fetch(`${base}/v1/tunnels`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ port: targetAddress.port, ttlSeconds: 30 }),
    });
    const tunnel = await created.json() as { id: string };
    const client = new WebSocket(`ws://127.0.0.1:${companion.address().port}/v1/tunnels/${tunnel.id}/hmr`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise<void>((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    const closed = new Promise<number>((resolve) => client.once("close", resolve));
    const chunk = Buffer.alloc(1024 * 1024);
    for (let index = 0; index < 5; index += 1) client.send(chunk);
    try {
      await expect(closed).resolves.toBe(1013);
    } finally {
      for (const socket of stalledSockets) socket.destroy();
    }
  });
});
