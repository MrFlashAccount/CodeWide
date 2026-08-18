import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { createServer, type Server } from "node:net";

import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { startHostCompanion, type RunningHostCompanion } from "../src/index.js";

describe("native local port forwards", () => {
  let companion: RunningHostCompanion | undefined;
  let target: Server | undefined;

  afterEach(async () => {
    await companion?.close();
    companion = undefined;
    const activeTarget = target;
    target = undefined;
    if (activeTarget !== undefined) {
      await new Promise<void>((resolve) => activeTarget.close(() => resolve()));
    }
  });

  it("bridges an opaque binary stream to an explicit host loopback port", async () => {
    target = createServer((socket) => socket.on("data", (chunk) => socket.write(Buffer.concat([Buffer.from("echo:"), chunk]))));
    await new Promise<void>((resolve, reject) => {
      target?.once("error", reject);
      target?.listen(0, "127.0.0.1", resolve);
    });
    const targetAddress = target.address();
    if (targetAddress === null || typeof targetAddress === "string") throw new Error("Unexpected target address");

    const token = "p".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token });
    const socket = new WebSocket(`ws://127.0.0.1:${companion.address().port}/v1/port-forwards/${targetAddress.port}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const response = new Promise<Buffer>((resolve) => socket.once("message", (data) => resolve(Buffer.from(data as ArrayBuffer))));
    socket.send(Buffer.from("hello"));
    await expect(response).resolves.toEqual(Buffer.from("echo:hello"));
    socket.close();
  });

  it("rejects browser origins and unavailable target ports without affecting health", async () => {
    const unavailable = createServer();
    await new Promise<void>((resolve, reject) => {
      unavailable.once("error", reject);
      unavailable.listen(0, "127.0.0.1", resolve);
    });
    const unavailableAddress = unavailable.address();
    if (unavailableAddress === null || typeof unavailableAddress === "string") throw new Error("Unexpected target address");
    await new Promise<void>((resolve) => unavailable.close(() => resolve()));

    const token = "r".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token });
    const base = `ws://127.0.0.1:${companion.address().port}/v1/port-forwards/${unavailableAddress.port}`;
    const browser = new WebSocket(base, { headers: { authorization: `Bearer ${token}`, origin: "https://browser.invalid" } });
    const browserFailure = new Promise<number>((resolve) => browser.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0)));
    await expect(browserFailure).resolves.toBe(401);

    const missing = new WebSocket(base, { headers: { authorization: `Bearer ${token}` } });
    const missingFailure = new Promise<number>((resolve) => missing.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0)));
    await expect(missingFailure).resolves.toBe(502);

    const health = await fetch(`http://127.0.0.1:${companion.address().port}/healthz`);
    expect(health.status).toBe(200);
  });

  it("expires an active stream with its short-lived device session", async () => {
    target = createServer((socket) => socket.on("data", (chunk) => socket.write(chunk)));
    await new Promise<void>((resolve, reject) => {
      target?.once("error", reject);
      target?.listen(0, "127.0.0.1", resolve);
    });
    const targetAddress = target.address();
    if (targetAddress === null || typeof targetAddress === "string") throw new Error("Unexpected target address");

    const admin = "s".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: admin, sessionTtlMs: 1_000 });
    const pairing = await companion.createPairing();
    const proof = createDeviceProof();
    const base = `http://127.0.0.1:${companion.address().port}`;
    const claim = await fetch(`${base}/v1/pairing/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingToken: pairing.pairingToken, deviceId: "forward-test-phone", deviceName: "Forward test", publicKeySpki: proof.publicKeySpki }),
    });
    expect(claim.status).toBe(201);
    const device = await claim.json() as { capabilityToken: string };
    const session = await mintDeviceSession(base, device.capabilityToken, proof.privateKey);
    const socket = new WebSocket(
      `ws://127.0.0.1:${companion.address().port}/v1/port-forwards/${targetAddress.port}`,
      { headers: { authorization: `Bearer ${session.sessionToken}` } },
    );
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.once("close", (code, reason) => resolve({ code, reason: reason.toString("utf8") }));
    });
    await expect(closed).resolves.toEqual({ code: 4003, reason: "session_expired" });
  });
});

function createDeviceProof(): { publicKeySpki: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { publicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64"), privateKey };
}

async function mintDeviceSession(base: string, capabilityToken: string, privateKey: KeyObject): Promise<{ sessionToken: string }> {
  const challengeResponse = await fetch(`${base}/v1/sessions/challenge`, {
    method: "POST",
    headers: { authorization: `Bearer ${capabilityToken}` },
  });
  if (!challengeResponse.ok) throw new Error(`Session challenge failed: ${challengeResponse.status}`);
  const challenge = await challengeResponse.json() as { challengeId: string; challenge: string };
  const signature = sign("sha256", Buffer.from(challenge.challenge, "base64url"), privateKey).toString("base64");
  const response = await fetch(`${base}/v1/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${capabilityToken}`, "content-type": "application/json" },
    body: JSON.stringify({ challengeId: challenge.challengeId, signature }),
  });
  if (!response.ok) throw new Error(`Session mint failed: ${response.status}`);
  return await response.json() as { sessionToken: string };
}
