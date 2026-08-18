import { generateKeyPairSync, randomUUID, sign } from "node:crypto";

import { WebSocket } from "ws";

type Pairing = { endpoint: string; pairingToken: string };
type JsonObject = Record<string, unknown>;

const pairing = parsePairing(process.env.CODEWIDE_PAIRING_JSON);
const origin = pairing.endpoint.replace(/^wss:/u, "https:").replace(/^ws:/u, "http:").replace(/\/v1\/sync$/u, "");
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const deviceId = `external-smoke-${randomUUID()}`;

const claim = await postJson<{ capabilityToken: string }>(`${origin}/v1/pairing/claim`, undefined, {
  pairingToken: pairing.pairingToken,
  deviceId,
  deviceName: "CodeWide external transport smoke",
  publicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
});
const challenge = await postJson<{ challengeId: string; challenge: string }>(
  `${origin}/v1/sessions/challenge`,
  claim.capabilityToken,
  {},
);
const credential = await postJson<{ sessionToken: string }>(`${origin}/v1/sessions`, claim.capabilityToken, {
  challengeId: challenge.challengeId,
  signature: sign("sha256", Buffer.from(challenge.challenge, "base64url"), privateKey).toString("base64"),
});

const socket = new WebSocket(pairing.endpoint, { headers: { authorization: `Bearer ${credential.sessionToken}` } });
const messages: JsonObject[] = [];
const waiters = new Set<() => void>();
socket.on("message", (data) => {
  messages.push(JSON.parse(data.toString("utf8")) as JsonObject);
  for (const waiter of waiters) waiter();
});
await new Promise<void>((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});
socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
const hello = await waitFor((message) => message.type === "hello");
await waitFor((message) => message.type === "status" && message.status === "live");
const snapshotStartedAt = Date.now();
let requestId = 0;
let threadCount = 0;
let pageCount = 0;
for (const archived of [false, true]) {
  let cursor: string | null = null;
  do {
    const id = ++requestId;
    socket.send(JSON.stringify({
      type: "rpc",
      request: {
        id,
        method: "thread/list",
        params: { cursor, limit: 100, sortKey: "updated_at", sortDirection: "desc", archived, useStateDbOnly: true },
      },
    }));
    const envelope = await waitFor((message) => message.type === "rpc" && object(message.response)?.id === id, 60_000);
    const response = object(envelope.response);
    const result = object(response?.result);
    if (response?.error !== undefined || !Array.isArray(result?.data)) {
      throw new Error(`External thread/list failed: ${JSON.stringify(response?.error ?? "invalid response")}`);
    }
    threadCount += result.data.length;
    pageCount += 1;
    cursor = typeof result.nextCursor === "string" ? result.nextCursor : null;
  } while (cursor !== null);
}
socket.send(JSON.stringify({ type: "snapshotApplied", cursor: hello.headCursor }));
await waitFor((message) => message.type === "caughtUp", 60_000);
socket.close(1000, "smoke_complete");
process.stdout.write(`${JSON.stringify({
  ok: true,
  transport: "safe-zrok-device-session",
  threadCount,
  pageCount,
  snapshotDurationMs: Date.now() - snapshotStartedAt,
})}\n`);

async function postJson<T>(url: string, bearer: string | undefined, body: JsonObject): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${new URL(url).pathname} failed (${response.status})`);
  return await response.json() as T;
}

function parsePairing(raw: string | undefined): Pairing {
  if (raw === undefined) throw new Error("CODEWIDE_PAIRING_JSON is required");
  const value = object(JSON.parse(raw) as unknown);
  if (typeof value?.endpoint !== "string" || typeof value.pairingToken !== "string") throw new Error("Invalid pairing JSON");
  return { endpoint: value.endpoint, pairingToken: value.pairingToken };
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

async function waitFor(predicate: (message: JsonObject) => boolean, timeoutMs = 15_000): Promise<JsonObject> {
  const existing = messages.find(predicate);
  if (existing !== undefined) return existing;
  return await new Promise<JsonObject>((resolve, reject) => {
    const timeout = setTimeout(() => {
      waiters.delete(check);
      reject(new Error(`Timed out waiting for external transport message; received ${messages.map((message) => message.type).join(",")}`));
    }, timeoutMs);
    const check = () => {
      const message = messages.find(predicate);
      if (message === undefined) return;
      clearTimeout(timeout);
      waiters.delete(check);
      resolve(message);
    };
    waiters.add(check);
  });
}
