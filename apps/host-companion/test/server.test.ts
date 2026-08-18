import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_DEVICE_SCOPES, createCapabilityToken, startHostCompanion, type RunningHostCompanion } from "../src/index.js";

describe("host companion", () => {
  let companion: RunningHostCompanion | undefined;
  let upstreamServer: WebSocketServer | undefined;

  afterEach(async () => {
    const current = companion;
    companion = undefined;
    await current?.close();
    const currentUpstream = upstreamServer;
    upstreamServer = undefined;
    await new Promise<void>((resolve, reject) => {
      if (currentUpstream === undefined) resolve();
      else currentUpstream.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const startEchoUpstream = async (): Promise<() => WebSocket> => {
    upstreamServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      upstreamServer?.once("listening", resolve);
      upstreamServer?.once("error", reject);
    });
    upstreamServer.on("connection", (socket) => {
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString()) as { id?: number; method: string };
        if (message.id !== undefined) {
          socket.send(JSON.stringify({ id: message.id, result: { method: message.method } }));
        }
      });
    });
    const address = upstreamServer.address();
    if (address === null || typeof address === "string") throw new Error("Unexpected test address");
    return () => new WebSocket(`ws://127.0.0.1:${address.port}`);
  };

  it("rejects an accidental non-loopback listener", async () => {
    await expect(startHostCompanion({
      host: "0.0.0.0",
      port: 0,
      capabilityToken: "n".repeat(43),
    })).rejects.toThrow("explicit allowNonLoopback opt-in");
  });

  it("proxies only public build shelf routes through the companion", async () => {
    const shelfRequests: Array<{ path: string; runtime: string | undefined }> = [];
    const shelf = createServer((request, response) => {
      shelfRequests.push({
        path: request.url ?? "",
        runtime: Array.isArray(request.headers["expo-runtime-version"])
          ? request.headers["expo-runtime-version"][0]
          : request.headers["expo-runtime-version"],
      });
      response.writeHead(200, {
        "content-type": "multipart/mixed; boundary=test",
        "expo-protocol-version": "1",
      });
      response.end("manifest");
    });
    await new Promise<void>((resolve, reject) => {
      shelf.once("error", reject);
      shelf.listen(0, "127.0.0.1", resolve);
    });
    const shelfAddress = shelf.address();
    if (shelfAddress === null || typeof shelfAddress === "string") throw new Error("Unexpected shelf address");

    try {
      companion = await startHostCompanion({
        host: "127.0.0.1",
        port: 0,
        capabilityToken: "s".repeat(43),
        buildShelfOrigin: `http://127.0.0.1:${shelfAddress.port}`,
      });
      const { port } = companion.address();
      const update = await fetch(`http://127.0.0.1:${port}/api/updates`, {
        headers: { "expo-runtime-version": "0.2.8-native-21" },
      });
      expect(update.status).toBe(200);
      expect(update.headers.get("expo-protocol-version")).toBe("1");
      expect(await update.text()).toBe("manifest");
      expect(shelfRequests).toEqual([{ path: "/api/updates", runtime: "0.2.8-native-21" }]);

      const privatePath = await fetch(`http://127.0.0.1:${port}/api/private`);
      expect(privatePath.status).toBe(404);
      expect(shelfRequests).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) => shelf.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("rejects a non-loopback build shelf origin", async () => {
    await expect(startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: "s".repeat(43),
      buildShelfOrigin: "https://downloads.example.com",
    })).rejects.toThrow("http loopback URL");
  });

  it("bridges authenticated text JSON without exposing a browser origin", async () => {
    const connectUpstream = await startEchoUpstream();
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: "a".repeat(43),
      connectUpstream,
    });
    const { port } = companion.address();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/app-server`, {
      headers: { authorization: `Bearer ${"a".repeat(43)}` },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const initialized = new Promise<string>((resolve) => socket.once("message", (data) => resolve(data.toString())));
    socket.send(JSON.stringify({ id: 1, method: "initialize", params: {} }));
    await expect(initialized).resolves.toBe('{"id":1,"result":{"method":"initialize"}}');
    socket.send(JSON.stringify({ method: "initialized" }));
    const response = new Promise<string>((resolve) => socket.once("message", (data) => resolve(data.toString())));
    socket.send(JSON.stringify({ id: 7, method: "thread/list", params: {} }));
    await expect(response).resolves.toBe('{"id":7,"result":{"method":"thread/list"}}');
    socket.close();
  });

  it("rejects missing tokens and browser origins", async () => {
    const connectUpstream = await startEchoUpstream();
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: "b".repeat(43),
      connectUpstream,
    });
    const { port } = companion.address();
    const missing = new WebSocket(`ws://127.0.0.1:${port}/v1/app-server`);
    await expect(new Promise((_, reject) => missing.once("error", reject))).rejects.toThrow("401");

    const browser = new WebSocket(`ws://127.0.0.1:${port}/v1/app-server`, {
      headers: {
        authorization: `Bearer ${"b".repeat(43)}`,
        origin: "https://evil.invalid",
      },
    });
    await expect(new Promise((_, reject) => browser.once("error", reject))).rejects.toThrow("401");
  });

  it("creates capability tokens with private permissions", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-token-"));
    const tokenPath = path.join(directory, "token");
    const token = await createCapabilityToken(tokenPath);
    const metadata = await stat(tokenPath);
    expect(token).toHaveLength(43);
    expect((metadata.mode & 0o777).toString(8)).toBe("600");
    expect((await readFile(tokenPath, "utf8")).trim()).toBe(token);
  });

  it("claims short-lived pairing once and revokes a persisted per-device capability", async () => {
    const connectUpstream = await startEchoUpstream();
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-devices-"));
    const registryPath = path.join(directory, "devices.json");
    const admin = "p".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: admin,
      connectUpstream,
      deviceRegistryPath: registryPath,
    });
    const pairing = await companion.createPairing();
    const proof = createDeviceProof();
    const { port } = companion.address();
    const base = `http://127.0.0.1:${port}`;
    const claim = await fetch(`${base}/v1/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingToken: pairing.pairingToken, deviceId: "phone-1", deviceName: "Test phone", publicKeySpki: proof.publicKeySpki }),
    });
    expect(claim.status).toBe(201);
    const device = await claim.json() as { deviceId: string; capabilityToken: string; scopes: string[] };
    expect(device.capabilityToken).toHaveLength(43);
    expect(device.scopes).toContain("threads.read");
    expect(device.scopes).not.toContain("shell.explicit");
    const invalidMetadataPairing = await companion.createPairing();
    const invalidMetadata = await fetch(`${base}/v1/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingToken: invalidMetadataPairing.pairingToken, deviceId: "../bad", deviceName: "Bad\nName", publicKeySpki: proof.publicKeySpki }),
    });
    expect(invalidMetadata.status).toBe(400);
    const reused = await fetch(`${base}/v1/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingToken: pairing.pairingToken, deviceId: "phone-2", deviceName: "Replay", publicKeySpki: proof.publicKeySpki }),
    });
    expect(reused.status).toBe(401);

    const rawBridge = new WebSocket(`ws://127.0.0.1:${port}/v1/app-server`, {
      headers: { authorization: `Bearer ${device.capabilityToken}` },
    });
    await expect(new Promise((_, reject) => rawBridge.once("error", reject))).rejects.toThrow("401");
    const longLivedSync = new WebSocket(`ws://127.0.0.1:${port}/v1/sync`, {
      headers: { authorization: `Bearer ${device.capabilityToken}` },
    });
    await expect(new Promise((_, reject) => longLivedSync.once("error", reject))).rejects.toThrow("401");
    const proofChallengeResponse = await fetch(`${base}/v1/sessions/challenge`, {
      method: "POST",
      headers: { authorization: `Bearer ${device.capabilityToken}` },
    });
    const proofChallenge = await proofChallengeResponse.json() as { challengeId: string; challenge: string };
    const attacker = createDeviceProof();
    const invalidProof = await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${device.capabilityToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: proofChallenge.challengeId,
        signature: sign("sha256", Buffer.from(proofChallenge.challenge, "base64url"), attacker.privateKey).toString("base64"),
      }),
    });
    expect(invalidProof.status).toBe(409);
    const replayedProof = await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${device.capabilityToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: proofChallenge.challengeId,
        signature: sign("sha256", Buffer.from(proofChallenge.challenge, "base64url"), proof.privateKey).toString("base64"),
      }),
    });
    expect(replayedProof.status).toBe(401);
    const session = await mintDeviceSession(base, device.capabilityToken, proof.privateKey);
    expect(session.expiresAt).toBeGreaterThan(Date.now());
    expect(session.scopes).toContain("threads.read");
    const chainedSession = await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.sessionToken}` },
    });
    expect(chainedSession.status).toBe(401);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/sync`, {
      headers: { authorization: `Bearer ${session.sessionToken}` },
    });
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const revokedSocket = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.once("close", (code, reason) => resolve({ code, reason: reason.toString("utf8") }));
    });

    const devices = await fetch(`${base}/v1/devices`, { headers: { authorization: `Bearer ${admin}` } });
    const listing = await devices.text();
    expect(listing).toContain("phone-1");
    expect(listing).toContain("threads.read");
    expect(listing).not.toContain("shell.explicit");
    expect(listing).not.toContain(device.capabilityToken);
    expect((await stat(registryPath)).mode & 0o077).toBe(0);

    const revoked = await fetch(`${base}/v1/devices/${device.deviceId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${admin}` },
    });
    expect(revoked.status).toBe(200);
    await expect(revokedSocket).resolves.toEqual({ code: 4003, reason: "device_revoked" });
    const rejected = new WebSocket(`ws://127.0.0.1:${port}/v1/sync`, {
      headers: { authorization: `Bearer ${session.sessionToken}` },
    });
    await expect(new Promise((_, reject) => rejected.once("error", reject))).rejects.toThrow("401");
  });

  it("enforces per-device RPC scopes and requires an explicit admin grant for raw shell execution", async () => {
    const connectUpstream = await startEchoUpstream();
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-scopes-"));
    const workspace = path.join(directory, "workspace");
    await mkdir(workspace);
    await writeFile(path.join(workspace, "allowed.txt"), "scoped", "utf8");
    const admin = "g".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: admin,
      connectUpstream,
      deviceRegistryPath: path.join(directory, "devices.json"),
      fileRoots: { workspace },
    });
    const pairing = await companion.createPairing();
    const proof = createDeviceProof();
    const { port } = companion.address();
    const base = `http://127.0.0.1:${port}`;
    const claim = await fetch(`${base}/v1/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingToken: pairing.pairingToken, deviceId: "scoped-phone", deviceName: "Scoped phone", publicKeySpki: proof.publicKeySpki }),
    });
    const device = await claim.json() as { capabilityToken: string };
    const deviceHeaders = { authorization: `Bearer ${device.capabilityToken}` };
    const longBearerDownload = await fetch(`${base}/v1/files/download?rootId=workspace&path=allowed.txt`, { headers: deviceHeaders });
    expect(longBearerDownload.status).toBe(401);
    const firstChallenge = await beginDeviceSession(base, device.capabilityToken);
    const secondChallenge = await beginDeviceSession(base, device.capabilityToken);
    const [firstParallelSession, secondParallelSession] = await Promise.all([
      finishDeviceSession(base, device.capabilityToken, proof.privateKey, firstChallenge),
      finishDeviceSession(base, device.capabilityToken, proof.privateKey, secondChallenge),
    ]);
    expect(firstParallelSession.sessionToken).not.toBe(secondParallelSession.sessionToken);
    const defaultSession = await mintDeviceSession(base, device.capabilityToken, proof.privateKey);
    const defaultDownload = await fetch(`${base}/v1/files/download?rootId=workspace&path=allowed.txt`, {
      headers: { authorization: `Bearer ${defaultSession.sessionToken}` },
    });
    expect(await defaultDownload.text()).toBe("scoped");

    const restrict = await fetch(`${base}/v1/devices/scoped-phone`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" },
      body: JSON.stringify({ scopes: ["threads.read"] }),
    });
    expect(restrict.status).toBe(200);
    const restrictedSession = await mintDeviceSession(base, device.capabilityToken, proof.privateKey);
    const restrictedHeaders = { authorization: `Bearer ${restrictedSession.sessionToken}` };
    const deniedDownload = await fetch(`${base}/v1/files/download?rootId=workspace&path=allowed.txt`, { headers: restrictedHeaders });
    expect(deniedDownload.status).toBe(401);
    const deniedTunnel = await fetch(`${base}/v1/tunnels`, {
      method: "POST",
      headers: { ...restrictedHeaders, "content-type": "application/json" },
      body: JSON.stringify({ port: 3_000 }),
    });
    expect(deniedTunnel.status).toBe(401);

    const connectDevice = async (): Promise<WebSocket> => {
      const session = await mintDeviceSession(base, device.capabilityToken, proof.privateKey);
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/sync`, {
        headers: { authorization: `Bearer ${session.sessionToken}` },
      });
      const live = nextJsonMessage(socket, (message) => message.type === "status" && message.status === "live");
      await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
      await live;
      return socket;
    };

    const scoped = await connectDevice();
    const allowed = nextJsonMessage(scoped, (message) => (message.response as { id?: unknown } | undefined)?.id === "read");
    scoped.send(JSON.stringify({ type: "rpc", request: { id: "read", method: "thread/list", params: {} } }));
    await expect(allowed).resolves.toMatchObject({ response: { id: "read", result: { method: "thread/list" } } });
    const denied = nextJsonMessage(scoped, (message) => (message.response as { id?: unknown } | undefined)?.id === "shell");
    scoped.send(JSON.stringify({ type: "rpc", request: { id: "shell", method: "command/exec", params: { command: "id" } } }));
    await expect(denied).resolves.toMatchObject({
      response: { id: "shell", error: { code: -32001, message: "Capability does not allow RPC method: command/exec" } },
    });
    const scopesChanged = new Promise<{ code: number; reason: string }>((resolve) => {
      scoped.once("close", (code, reason) => resolve({ code, reason: reason.toString("utf8") }));
    });
    const grant = await fetch(`${base}/v1/devices/scoped-phone`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" },
      body: JSON.stringify({ scopes: [...DEFAULT_DEVICE_SCOPES, "shell.explicit"] }),
    });
    expect(grant.status).toBe(200);
    await expect(scopesChanged).resolves.toEqual({ code: 4003, reason: "device_scopes_changed" });

    const privileged = await connectDevice();
    const executed = nextJsonMessage(privileged, (message) => (message.response as { id?: unknown } | undefined)?.id === "shell-granted");
    privileged.send(JSON.stringify({ type: "rpc", request: { id: "shell-granted", method: "command/exec", params: { command: "id" } } }));
    await expect(executed).resolves.toMatchObject({ response: { id: "shell-granted", result: { method: "command/exec" } } });
    privileged.close();
  });

  it("keeps short-lived session tokens out of persistent state and expires active sockets", async () => {
    const connectUpstream = await startEchoUpstream();
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-session-"));
    const registryPath = path.join(directory, "devices.json");
    const admin = "e".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: admin,
      connectUpstream,
      deviceRegistryPath: registryPath,
      sessionTtlMs: 1_100,
    });
    const pairing = await companion.createPairing();
    const proof = createDeviceProof();
    const { port } = companion.address();
    const base = `http://127.0.0.1:${port}`;
    const claim = await fetch(`${base}/v1/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingToken: pairing.pairingToken, deviceId: "expiry-phone", deviceName: "Expiry phone", publicKeySpki: proof.publicKeySpki }),
    });
    const device = await claim.json() as { capabilityToken: string };
    const session = await mintDeviceSession(base, device.capabilityToken, proof.privateKey);
    expect(await readFile(registryPath, "utf8")).not.toContain(session.sessionToken);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/sync`, {
      headers: { authorization: `Bearer ${session.sessionToken}` },
    });
    const expired = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.once("close", (code, reason) => resolve({ code, reason: reason.toString("utf8") }));
    });
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await expect(expired).resolves.toEqual({ code: 4003, reason: "session_expired" });
  });

  it("loads legacy bearer records but fails closed until the device pairs a public key", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-legacy-device-"));
    const registryPath = path.join(directory, "devices.json");
    const legacyToken = "l".repeat(43);
    await writeFile(registryPath, JSON.stringify({
      version: 2,
      devices: [{
        id: "legacy-phone",
        name: "Legacy phone",
        tokenHash: createHash("sha256").update(legacyToken).digest("hex"),
        scopes: [...DEFAULT_DEVICE_SCOPES],
        createdAt: 1,
        lastSeenAt: 1,
      }],
      pairings: [],
    }));
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: "m".repeat(43),
      deviceRegistryPath: registryPath,
    });
    const challenge = await fetch(`http://127.0.0.1:${companion.address().port}/v1/sessions/challenge`, {
      method: "POST",
      headers: { authorization: `Bearer ${legacyToken}` },
    });
    expect(challenge.status).toBe(409);
    await expect(challenge.json()).resolves.toEqual({ error: "device_key_required_repair" });
  });

  it("continues a mirrored queue after the phone sync socket disconnects", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-host-queue-"));
    const queuePath = path.join(directory, "queue.json");
    upstreamServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      upstreamServer?.once("listening", resolve);
      upstreamServer?.once("error", reject);
    });
    let releaseThreadRead: (() => void) | undefined;
    const threadReadRequested = new Promise<void>((resolve) => { releaseThreadRead = resolve; });
    let answerThreadRead: (() => void) | undefined;
    const threadReadGate = new Promise<void>((resolve) => { answerThreadRead = resolve; });
    let turnStartCount = 0;
    const turnStarted = new Promise<Record<string, unknown>>((resolve) => {
      upstreamServer?.on("connection", (socket) => {
        socket.on("message", (data) => {
          const message = JSON.parse(data.toString()) as { id?: unknown; method?: string; params?: Record<string, unknown> };
          if (message.method === "initialize") {
            socket.send(JSON.stringify({ id: message.id, result: {} }));
          } else if (message.method === "thread/turns/list") {
            releaseThreadRead?.();
            void threadReadGate.then(() => socket.send(JSON.stringify({
              id: message.id,
              result: { data: [], nextCursor: null },
            })));
          } else if (message.method === "turn/start") {
            turnStartCount += 1;
            resolve(message.params ?? {});
            socket.send(JSON.stringify({ id: message.id, result: { turn: { id: "turn-queue" } } }));
          }
        });
      });
    });
    const upstreamAddress = upstreamServer.address();
    if (upstreamAddress === null || typeof upstreamAddress === "string") throw new Error("Unexpected test address");
    const token = "q".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: token,
      queuePath,
      connectUpstream: () => new WebSocket(`ws://127.0.0.1:${upstreamAddress.port}`),
    });
    const { port } = companion.address();
    const client = new WebSocket(`ws://127.0.0.1:${port}/v1/sync`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise<void>((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    client.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    const putResponse = new Promise<Record<string, unknown>>((resolve) => {
      const listener = (data: WebSocket.RawData) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        const response = message.response as Record<string, unknown> | undefined;
        if (message.type === "rpc" && response?.id === "queue-put") {
          client.off("message", listener);
          resolve(response);
        }
      };
      client.on("message", listener);
    });
    client.send(JSON.stringify({
      type: "rpc",
      request: {
        id: "queue-put",
        method: "companion/queue/put",
        params: {
          command: {
            commandId: "client-queue-1",
            remoteThreadId: "thread-queue",
            method: "turn/start",
            createdAt: 1,
            params: {
              threadId: "thread-queue",
              clientUserMessageId: "client-queue-1",
              input: [{ type: "text", text: "keep working" }],
            },
          },
        },
      },
    }));
    await expect(putResponse).resolves.toHaveProperty("result.commandId", "client-queue-1");
    await threadReadRequested;
    const clientClosed = new Promise<void>((resolve) => client.once("close", () => resolve()));
    client.close();
    await clientClosed;
    answerThreadRead?.();
    await expect(turnStarted).resolves.toMatchObject({
      threadId: "thread-queue",
      clientUserMessageId: "client-queue-1",
    });
    await expect.poll(async () => JSON.parse(await readFile(queuePath, "utf8")) as { commands: Array<{ state: string }> })
      .toMatchObject({ commands: [{ state: "delivered" }] });

    const reconnected = new WebSocket(`ws://127.0.0.1:${port}/v1/sync`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise<void>((resolve, reject) => { reconnected.once("open", resolve); reconnected.once("error", reject); });
    reconnected.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    const receipt = new Promise<Record<string, unknown>>((resolve) => {
      reconnected.on("message", (data) => {
        const message = JSON.parse(data.toString()) as { type?: string; response?: Record<string, unknown> };
        if (message.type === "rpc" && message.response?.id === "queue-reput") resolve(message.response);
      });
    });
    reconnected.send(JSON.stringify({
      type: "rpc",
      request: {
        id: "queue-reput",
        method: "companion/queue/put",
        params: {
          command: {
            commandId: "client-queue-1",
            remoteThreadId: "thread-queue",
            method: "turn/start",
            createdAt: 1,
            params: {
              threadId: "thread-queue",
              clientUserMessageId: "client-queue-1",
              input: [{ type: "text", text: "keep working" }],
            },
          },
        },
      },
    }));
    await expect(receipt).resolves.toHaveProperty("result.state", "delivered");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(turnStartCount).toBe(1);
    reconnected.close();
  });

  it("resolves scoped mobile attachments into App Server local inputs", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-inputs-"));
    const root = path.join(directory, "workspace");
    const outside = path.join(directory, "outside.png");
    await mkdir(root);
    await writeFile(path.join(root, "screen.png"), "image", "utf8");
    await writeFile(outside, "private", "utf8");
    await symlink(outside, path.join(root, "escape.png"));
    upstreamServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      upstreamServer?.once("listening", resolve);
      upstreamServer?.once("error", reject);
    });
    let turnStartCount = 0;
    let resolveTurnStart: ((params: Record<string, unknown>) => void) | undefined;
    const turnStarted = new Promise<Record<string, unknown>>((resolve) => { resolveTurnStart = resolve; });
    upstreamServer.on("connection", (socket) => {
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString()) as { id?: unknown; method?: string; params?: Record<string, unknown> };
        if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));
        else if (message.method === "turn/start") {
          turnStartCount += 1;
          resolveTurnStart?.(message.params ?? {});
          socket.send(JSON.stringify({ id: message.id, result: { turn: { id: "attachment-turn" } } }));
        }
      });
    });
    const upstreamAddress = upstreamServer.address();
    if (upstreamAddress === null || typeof upstreamAddress === "string") throw new Error("Unexpected test address");
    const token = "f".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: token,
      fileRoots: { workspace: root },
      connectUpstream: () => new WebSocket(`ws://127.0.0.1:${upstreamAddress.port}`),
    });
    const client = new WebSocket(`ws://127.0.0.1:${companion.address().port}/v1/sync`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const live = nextJsonMessage(client, (message) => message.type === "status" && message.status === "live");
    await new Promise<void>((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    client.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await live;
    const accepted = nextJsonMessage(client, (message) => (message.response as { id?: unknown } | undefined)?.id === "attach");
    client.send(JSON.stringify({
      type: "rpc",
      request: {
        id: "attach",
        method: "turn/start",
        params: {
          threadId: "thread-1",
          input: [
            { type: "text", text: "inspect" },
            { type: "remoteFile", rootId: "workspace", path: "screen.png", name: "screen.png", kind: "image" },
          ],
        },
      },
    }));
    await expect(turnStarted).resolves.toMatchObject({
      input: [
        { type: "text", text: "inspect" },
        { type: "localImage", path: await realpath(path.join(root, "screen.png")) },
      ],
    });
    await expect(accepted).resolves.toMatchObject({ response: { id: "attach", result: { turn: { id: "attachment-turn" } } } });

    const denied = nextJsonMessage(client, (message) => (message.response as { id?: unknown } | undefined)?.id === "escape");
    client.send(JSON.stringify({
      type: "rpc",
      request: {
        id: "escape",
        method: "turn/start",
        params: { threadId: "thread-1", input: [{ type: "remoteFile", rootId: "workspace", path: "escape.png", name: "escape.png", kind: "image" }] },
      },
    }));
    await expect(denied).resolves.toMatchObject({ response: { id: "escape", error: { code: -32602, message: "path_outside_root" } } });
    expect(turnStartCount).toBe(1);
    client.close();
  });

  it("uploads, resumes and downloads files only inside explicit roots", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-files-"));
    const root = path.join(directory, "workspace");
    const outside = path.join(directory, "outside.txt");
    await mkdir(root);
    await writeFile(path.join(root, "source.txt"), "abcdef", "utf8");
    await writeFile(path.join(root, "guide.md"), "# Guide\n", "utf8");
    await writeFile(path.join(root, "source.ts"), "export const answer = 42;\n", "utf8");
    await writeFile(path.join(root, "source.rs"), "fn main() {}\n", "utf8");
    await writeFile(path.join(root, "archive.zip"), "not-really-a-zip", "utf8");
    await writeFile(outside, "private", "utf8");
    await symlink(outside, path.join(root, "escape.txt"));
    const token = "c".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: token,
      fileRoots: { workspace: root },
    });
    const { port } = companion.address();
    const base = `http://127.0.0.1:${port}`;
    const headers = { authorization: `Bearer ${token}` };

    const download = await fetch(`${base}/v1/files/download?rootId=workspace&path=source.txt`, { headers });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("abcdef");
    expect(download.headers.get("x-content-sha256")).toBe(createHash("sha256").update("abcdef").digest("hex"));

    const preview = await fetch(`${base}/v1/files/preview?path=${encodeURIComponent(await realpath(path.join(root, "source.txt")))}`, { headers });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-disposition")).toContain("inline");
    expect(preview.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(await preview.text()).toBe("abcdef");
    const markdownPreview = await fetch(`${base}/v1/files/preview?path=${encodeURIComponent(await realpath(path.join(root, "guide.md")))}`, { headers });
    expect(markdownPreview.status).toBe(200);
    expect(markdownPreview.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await markdownPreview.text()).toBe("# Guide\n");
    const typescriptPreview = await fetch(`${base}/v1/files/preview?path=${encodeURIComponent(await realpath(path.join(root, "source.ts")))}`, { headers });
    expect(typescriptPreview.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const rustPreview = await fetch(`${base}/v1/files/preview?path=${encodeURIComponent(await realpath(path.join(root, "source.rs")))}`, { headers });
    expect(rustPreview.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const archiveDownload = await fetch(`${base}/v1/files/download?rootId=workspace&path=archive.zip`, { headers });
    expect(archiveDownload.headers.get("content-type")).toBe("application/zip");
    const outsidePreview = await fetch(`${base}/v1/files/preview?path=${encodeURIComponent(await realpath(outside))}`, { headers });
    expect(outsidePreview.status).toBe(403);

    const range = await fetch(`${base}/v1/files/download?rootId=workspace&path=source.txt`, {
      headers: { ...headers, range: "bytes=2-4" },
    });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe("cde");

    const content = "uploaded-content";
    const contentHash = createHash("sha256").update(content).digest("hex");
    const upload = await fetch(`${base}/v1/files/upload?rootId=workspace&path=uploaded.txt`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/octet-stream", "x-content-sha256": contentHash },
      body: content,
    });
    expect(upload.status).toBe(201);
    expect(await readFile(path.join(root, "uploaded.txt"), "utf8")).toBe(content);

    const duplicateContent = "must-not-replace";
    const duplicate = await fetch(`${base}/v1/files/upload?rootId=workspace&path=uploaded.txt`, {
      method: "PUT",
      headers: {
        ...headers,
        "content-length": String(duplicateContent.length),
        "x-content-sha256": createHash("sha256").update(duplicateContent).digest("hex"),
      },
      body: duplicateContent,
    });
    expect(duplicate.status).toBe(409);
    expect(await readFile(path.join(root, "uploaded.txt"), "utf8")).toBe(content);

    const resumableContent = "resumable-upload-content";
    const resumableHash = createHash("sha256").update(resumableContent).digest("hex");
    const uploadId = `sha256-${resumableHash}`;
    const split = 9;
    const resumableUrl = `${base}/v1/files/upload?rootId=workspace&path=resumed.txt`;
    const firstChunk = await fetch(resumableUrl, {
      method: "PUT",
      headers: {
        ...headers,
        "x-upload-id": uploadId,
        "x-content-sha256": resumableHash,
        "content-range": `bytes 0-${split - 1}/${resumableContent.length}`,
      },
      body: resumableContent.slice(0, split),
      redirect: "manual",
    });
    expect(firstChunk.status).toBe(308);
    expect(firstChunk.headers.get("x-upload-offset")).toBe(String(split));

    const resumeStatus = await fetch(resumableUrl, {
      method: "HEAD",
      headers: { ...headers, "x-upload-id": uploadId, "x-content-sha256": resumableHash },
    });
    expect(resumeStatus.status).toBe(204);
    expect(resumeStatus.headers.get("x-upload-offset")).toBe(String(split));

    const staleChunk = await fetch(resumableUrl, {
      method: "PUT",
      headers: {
        ...headers,
        "x-upload-id": uploadId,
        "x-content-sha256": resumableHash,
        "content-range": `bytes 0-0/${resumableContent.length}`,
      },
      body: resumableContent.slice(0, 1),
    });
    expect(staleChunk.status).toBe(409);
    expect(staleChunk.headers.get("x-upload-offset")).toBe(String(split));

    const finalChunk = await fetch(resumableUrl, {
      method: "PUT",
      headers: {
        ...headers,
        "x-upload-id": uploadId,
        "x-content-sha256": resumableHash,
        "content-range": `bytes ${split}-${resumableContent.length - 1}/${resumableContent.length}`,
      },
      body: resumableContent.slice(split),
    });
    expect(finalChunk.status).toBe(201);
    expect(await readFile(path.join(root, "resumed.txt"), "utf8")).toBe(resumableContent);

    const completedStatus = await fetch(resumableUrl, {
      method: "HEAD",
      headers: { ...headers, "x-upload-id": uploadId, "x-content-sha256": resumableHash },
    });
    expect(completedStatus.status).toBe(200);
    expect(completedStatus.headers.get("x-upload-complete")).toBe("true");
    expect(completedStatus.headers.get("x-upload-offset")).toBe(String(resumableContent.length));

    const traversal = await fetch(`${base}/v1/files/download?rootId=workspace&path=..%2Foutside.txt`, { headers });
    expect(traversal.status).toBe(403);
    const symlinkEscape = await fetch(`${base}/v1/files/download?rootId=workspace&path=escape.txt`, { headers });
    expect(symlinkEscape.status).toBe(403);
    const unauthorized = await fetch(`${base}/v1/files/download?rootId=workspace&path=source.txt`);
    expect(unauthorized.status).toBe(401);
  });

  it("provides a private attachment root without host configuration", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-attachments-"));
    const token = "u".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: token,
      deviceRegistryPath: path.join(directory, "devices.json"),
    });
    const content = "picked on Android";
    const response = await fetch(`http://127.0.0.1:${companion.address().port}/v1/files/upload?rootId=attachments&path=selected.txt`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "text/plain",
        "x-content-sha256": createHash("sha256").update(content).digest("hex"),
      },
      body: content,
    });

    expect(response.status).toBe(201);
    expect(await readFile(path.join(directory, "attachments", "selected.txt"), "utf8")).toBe(content);
  });

  it("keeps remote images behind authentication and rejects SSRF targets", async () => {
    const token = "i".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token });
    const base = `http://127.0.0.1:${companion.address().port}`;
    const body = JSON.stringify({ url: "https://127.0.0.1/private.png" });

    const unauthorized = await fetch(`${base}/v1/media/materialize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(unauthorized.status).toBe(401);

    const blocked = await fetch(`${base}/v1/media/materialize`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
    });
    expect(blocked.status).toBe(400);
    await expect(blocked.json()).resolves.toEqual({ error: "unsafe_image_host" });

    const insecure = await fetch(`${base}/v1/media/materialize`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: "http://example.com/image.png" }),
    });
    expect(insecure.status).toBe(400);
    await expect(insecure.json()).resolves.toEqual({ error: "https_image_required" });
  });
});

function nextJsonMessage(socket: WebSocket, predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", listener);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 5_000);
    const listener = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", listener);
      resolve(message);
    };
    socket.on("message", listener);
  });
}

function createDeviceProof(): { publicKeySpki: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { publicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64"), privateKey };
}

async function mintDeviceSession(base: string, capabilityToken: string, privateKey: KeyObject): Promise<{ sessionToken: string; expiresAt: number; scopes: string[] }> {
  const challenge = await beginDeviceSession(base, capabilityToken);
  return await finishDeviceSession(base, capabilityToken, privateKey, challenge);
}

async function beginDeviceSession(base: string, capabilityToken: string): Promise<{ challengeId: string; challenge: string }> {
  const challengeResponse = await fetch(`${base}/v1/sessions/challenge`, {
    method: "POST",
    headers: { authorization: `Bearer ${capabilityToken}` },
  });
  if (!challengeResponse.ok) throw new Error(`Session challenge failed: ${challengeResponse.status}`);
  return await challengeResponse.json() as { challengeId: string; challenge: string };
}

async function finishDeviceSession(
  base: string,
  capabilityToken: string,
  privateKey: KeyObject,
  challenge: { challengeId: string; challenge: string },
): Promise<{ sessionToken: string; expiresAt: number; scopes: string[] }> {
  const signature = sign("sha256", Buffer.from(challenge.challenge, "base64url"), privateKey).toString("base64");
  const response = await fetch(`${base}/v1/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${capabilityToken}`, "content-type": "application/json" },
    body: JSON.stringify({ challengeId: challenge.challengeId, signature }),
  });
  if (!response.ok) throw new Error(`Session mint failed: ${response.status}`);
  return await response.json() as { sessionToken: string; expiresAt: number; scopes: string[] };
}
