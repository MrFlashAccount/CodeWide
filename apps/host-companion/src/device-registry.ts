import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { tokenMatches } from "./token.js";
import {
  DEFAULT_DEVICE_SCOPES,
  DEVICE_SCOPES,
  hasScope,
  parseDeviceScopes,
  type AuthorizationContext,
  type DeviceScope,
} from "./capabilities.js";

type Device = { id: string; name: string; tokenHash: string; publicKeySpki: string | null; scopes: DeviceScope[]; createdAt: number; lastSeenAt: number };
type LegacyDevice = Omit<Device, "scopes" | "publicKeySpki">;
type ScopedBearerDevice = Omit<Device, "publicKeySpki">;
type Pairing = { tokenHash: string; expiresAt: number };
type DeviceSession = { tokenHash: string; deviceId: string; scopes: DeviceScope[]; expiresAt: number };
type DeviceChallenge = { id: string; deviceId: string; nonce: string; expiresAt: number };
type RegistryFileV1 = { version: 1; devices: LegacyDevice[]; pairings: Pairing[] };
type RegistryFileV2 = { version: 2; devices: ScopedBearerDevice[]; pairings: Pairing[] };
type RegistryFile = { version: 3; devices: Device[]; pairings: Pairing[] };

const PAIRING_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1_000;
const CHALLENGE_TTL_MS = 60 * 1_000;
const MAX_SESSIONS_PER_DEVICE = 16;
const MAX_CHALLENGES_PER_DEVICE = 8;
const MAX_BODY_BYTES = 8 * 1024;

export class DeviceRegistry {
  readonly #adminToken: string;
  readonly #filePath: string | undefined;
  readonly #sessionTtlMs: number;
  readonly #devices = new Map<string, Device>();
  readonly #pairings = new Map<string, Pairing>();
  readonly #sessions = new Map<string, DeviceSession>();
  readonly #challenges = new Map<string, DeviceChallenge>();
  readonly #authorizationChangeListeners = new Set<(deviceId: string, reason: "device_revoked" | "device_scopes_changed") => void>();
  #writeChain = Promise.resolve();
  #claimWindowStartedAt = Date.now();
  #claimAttempts = 0;

  private constructor(adminToken: string, filePath?: string, sessionTtlMs = DEFAULT_SESSION_TTL_MS) {
    this.#adminToken = adminToken;
    this.#filePath = filePath;
    this.#sessionTtlMs = sessionTtlMs;
  }

  static async open(adminToken: string, filePath?: string, sessionTtlMs?: number): Promise<DeviceRegistry> {
    if (sessionTtlMs !== undefined && (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1_000)) throw new Error("Invalid device session TTL");
    const registry = new DeviceRegistry(adminToken, filePath, sessionTtlMs);
    if (filePath !== undefined) {
      const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (raw !== null) {
        const parsed = JSON.parse(raw) as RegistryFile | RegistryFileV2 | RegistryFileV1;
        if ((parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) || !Array.isArray(parsed.devices) || !Array.isArray(parsed.pairings)) throw new Error("Invalid device registry");
        if (parsed.version === 1) {
          for (const stored of parsed.devices) registry.#devices.set(stored.id, { ...stored, publicKeySpki: null, scopes: [...DEFAULT_DEVICE_SCOPES] });
        } else if (parsed.version === 2) {
          for (const stored of parsed.devices) {
            const scopes = parseDeviceScopes(stored.scopes);
            if (scopes === null) throw new Error("Invalid device registry scopes");
            registry.#devices.set(stored.id, { ...stored, publicKeySpki: null, scopes });
          }
        } else {
          for (const stored of parsed.devices) {
            const scopes = parseDeviceScopes(stored.scopes);
            if (scopes === null || (stored.publicKeySpki !== null && !validPublicKey(stored.publicKeySpki))) throw new Error("Invalid device registry credentials");
            registry.#devices.set(stored.id, { ...stored, scopes });
          }
        }
        for (const pairing of parsed.pairings) if (pairing.expiresAt > Date.now()) registry.#pairings.set(pairing.tokenHash, pairing);
      }
    }
    return registry;
  }

  authorize(authorization: string | undefined, requiredScope?: DeviceScope): boolean {
    const context = this.authorizationContext(authorization);
    return context !== null && (requiredScope === undefined || hasScope(context, requiredScope));
  }

  authorizationContext(authorization: string | undefined): AuthorizationContext | null {
    if (tokenMatches(this.#adminToken, authorization)) return { kind: "admin", deviceId: null, scopes: DEVICE_SCOPES };
    const token = bearerToken(authorization);
    if (token === null) return null;
    const hash = tokenHash(token);
    for (const device of this.#devices.values()) {
      if (safeEqual(device.tokenHash, hash)) {
        device.lastSeenAt = Date.now();
        return { kind: "device", deviceId: device.id, scopes: device.scopes };
      }
    }
    this.#purgeExpired();
    for (const session of this.#sessions.values()) {
      if (safeEqual(session.tokenHash, hash)) {
        return { kind: "session", deviceId: session.deviceId, scopes: session.scopes, expiresAt: session.expiresAt };
      }
    }
    return null;
  }

  authorizeSession(authorization: string | undefined, requiredScope?: DeviceScope): boolean {
    const context = this.authorizationContext(authorization);
    if (context === null || context.kind === "device") return false;
    return requiredScope === undefined || hasScope(context, requiredScope);
  }

  deviceIdForAuthorization(authorization: string | undefined): string | null {
    const context = this.authorizationContext(authorization);
    return context?.kind === "device" || context?.kind === "session" ? context.deviceId : null;
  }

  onAuthorizationChange(listener: (deviceId: string, reason: "device_revoked" | "device_scopes_changed") => void): () => void {
    this.#authorizationChangeListeners.add(listener);
    return () => this.#authorizationChangeListeners.delete(listener);
  }

  adminAuthorize(authorization: string | undefined): boolean {
    return tokenMatches(this.#adminToken, authorization);
  }

  async createPairing(): Promise<{ pairingToken: string; expiresAt: number }> {
    this.#purgeExpired();
    const pairingToken = randomBytes(32).toString("base64url");
    const pairing = { tokenHash: tokenHash(pairingToken), expiresAt: Date.now() + PAIRING_TTL_MS };
    this.#pairings.set(pairing.tokenHash, pairing);
    await this.#persist();
    return { pairingToken, expiresAt: pairing.expiresAt };
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith("/v1/pairing") && !requestUrl.pathname.startsWith("/v1/devices") && !requestUrl.pathname.startsWith("/v1/sessions")) return false;
    if (request.headers.origin !== undefined) {
      json(response, 401, { error: "browser_origin_rejected" });
      return true;
    }
    if (requestUrl.pathname === "/v1/pairing/claim" && request.method === "POST") {
      await this.#claim(request, response);
      return true;
    }
    if (requestUrl.pathname === "/v1/sessions/challenge" && request.method === "POST") {
      const context = this.authorizationContext(request.headers.authorization);
      if (context?.kind !== "device") {
        json(response, 401, { error: "device_authorization_required" });
        return true;
      }
      const device = this.#devices.get(context.deviceId);
      if (device?.publicKeySpki === null || device === undefined) {
        json(response, 409, { error: "device_key_required_repair" });
        return true;
      }
      this.#purgeExpired();
      this.#trimDeviceChallenges(context.deviceId);
      const challenge = {
        id: randomBytes(16).toString("base64url"),
        deviceId: context.deviceId,
        nonce: randomBytes(32).toString("base64url"),
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
      };
      this.#challenges.set(challenge.id, challenge);
      json(response, 201, { challengeId: challenge.id, challenge: challenge.nonce, expiresAt: challenge.expiresAt });
      return true;
    }
    if (requestUrl.pathname === "/v1/sessions" && request.method === "POST") {
      const context = this.authorizationContext(request.headers.authorization);
      if (context?.kind !== "device") {
        json(response, 401, { error: "device_authorization_required" });
        return true;
      }
      const body = await readJson(request);
      const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
      const signature = typeof body.signature === "string" ? body.signature : "";
      const challenge = this.#challenges.get(challengeId);
      this.#challenges.delete(challengeId);
      const device = this.#devices.get(context.deviceId);
      if (challenge === undefined || challenge.deviceId !== context.deviceId || challenge.expiresAt <= Date.now() || device?.publicKeySpki === null || device === undefined) {
        json(response, 401, { error: "invalid_or_expired_device_proof" });
        return true;
      }
      if (!validSignature(device.publicKeySpki, challenge.nonce, signature)) {
        json(response, 409, { error: "device_key_mismatch_repair" });
        return true;
      }
      const sessionToken = randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + this.#sessionTtlMs;
      const session = { tokenHash: tokenHash(sessionToken), deviceId: context.deviceId, scopes: [...context.scopes], expiresAt };
      const deviceSessions = [...this.#sessions.values()]
        .filter((candidate) => candidate.deviceId === context.deviceId)
        .sort((left, right) => left.expiresAt - right.expiresAt);
      for (const expired of deviceSessions.slice(0, Math.max(0, deviceSessions.length - MAX_SESSIONS_PER_DEVICE + 1))) {
        this.#sessions.delete(expired.tokenHash);
      }
      this.#sessions.set(session.tokenHash, session);
      json(response, 201, { sessionToken, expiresAt, scopes: session.scopes });
      return true;
    }
    if (!this.adminAuthorize(request.headers.authorization)) {
      json(response, 401, { error: "admin_authorization_required" });
      return true;
    }
    if (requestUrl.pathname === "/v1/pairing/start" && request.method === "POST") {
      json(response, 201, await this.createPairing());
      return true;
    }
    if (requestUrl.pathname === "/v1/devices" && request.method === "GET") {
      json(response, 200, { devices: [...this.#devices.values()].map(publicDevice) });
      return true;
    }
    const revoke = /^\/v1\/devices\/([^/]+)$/.exec(requestUrl.pathname);
    if (revoke !== null && request.method === "PATCH") {
      const deviceId = decodeURIComponent(revoke[1] ?? "");
      const device = this.#devices.get(deviceId);
      if (device === undefined) {
        json(response, 404, { error: "device_not_found" });
        return true;
      }
      const body = await readJson(request);
      const scopes = parseDeviceScopes(body.scopes);
      if (scopes === null || !scopes.includes("threads.read")) {
        json(response, 400, { error: "valid_scopes_with_threads_read_required" });
        return true;
      }
      device.scopes = scopes;
      this.#removeDeviceSessions(deviceId);
      this.#removeDeviceChallenges(deviceId);
      await this.#persist();
      for (const listener of this.#authorizationChangeListeners) listener(deviceId, "device_scopes_changed");
      json(response, 200, publicDevice(device));
      return true;
    }
    if (revoke !== null && request.method === "DELETE") {
      const deviceId = decodeURIComponent(revoke[1] ?? "");
      const removed = this.#devices.delete(deviceId);
      if (removed) {
        this.#removeDeviceSessions(deviceId);
        this.#removeDeviceChallenges(deviceId);
        await this.#persist();
        for (const listener of this.#authorizationChangeListeners) listener(deviceId, "device_revoked");
      }
      json(response, removed ? 200 : 404, { revoked: removed });
      return true;
    }
    json(response, 405, { error: "method_not_allowed" });
    return true;
  }

  async close(): Promise<void> {
    await this.#writeChain;
  }

  async #claim(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (Date.now() - this.#claimWindowStartedAt > 60_000) {
      this.#claimWindowStartedAt = Date.now();
      this.#claimAttempts = 0;
    }
    this.#claimAttempts += 1;
    if (this.#claimAttempts > 20) {
      json(response, 429, { error: "pairing_rate_limited" });
      return;
    }
    const body = await readJson(request);
    const pairingToken = typeof body.pairingToken === "string" ? body.pairingToken : "";
    const deviceName = typeof body.deviceName === "string" ? body.deviceName.trim() : "";
    const requestedId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    const publicKeySpki = typeof body.publicKeySpki === "string" ? body.publicKeySpki : "";
    if (
      deviceName.length < 1 || deviceName.length > 80 || /[\u0000-\u001f\u007f]/u.test(deviceName) ||
      requestedId.length > 128 || (requestedId !== "" && !/^[A-Za-z0-9._:-]+$/.test(requestedId)) || !validPublicKey(publicKeySpki)
    ) {
      json(response, 400, { error: "invalid_device_metadata" });
      return;
    }
    this.#purgeExpired();
    const hash = tokenHash(pairingToken);
    const pairing = [...this.#pairings.values()].find((candidate) => safeEqual(candidate.tokenHash, hash));
    if (pairing === undefined) {
      json(response, 401, { error: "invalid_or_expired_pairing" });
      return;
    }
    this.#pairings.delete(pairing.tokenHash);
    const id = requestedId || randomBytes(16).toString("base64url");
    const capabilityToken = randomBytes(32).toString("base64url");
    const now = Date.now();
    const scopes = [...DEFAULT_DEVICE_SCOPES];
    this.#devices.set(id, { id, name: deviceName, tokenHash: tokenHash(capabilityToken), publicKeySpki, scopes, createdAt: now, lastSeenAt: now });
    await this.#persist();
    json(response, 201, { deviceId: id, capabilityToken, scopes });
  }

  #purgeExpired(): void {
    const now = Date.now();
    for (const [hash, pairing] of this.#pairings) if (pairing.expiresAt <= now) this.#pairings.delete(hash);
    for (const [hash, session] of this.#sessions) if (session.expiresAt <= now) this.#sessions.delete(hash);
    for (const [id, challenge] of this.#challenges) if (challenge.expiresAt <= now) this.#challenges.delete(id);
  }

  #removeDeviceSessions(deviceId: string): void {
    for (const [hash, session] of this.#sessions) if (session.deviceId === deviceId) this.#sessions.delete(hash);
  }

  #removeDeviceChallenges(deviceId: string): void {
    for (const [id, challenge] of this.#challenges) if (challenge.deviceId === deviceId) this.#challenges.delete(id);
  }

  #trimDeviceChallenges(deviceId: string): void {
    const pending = [...this.#challenges.values()]
      .filter((challenge) => challenge.deviceId === deviceId)
      .sort((left, right) => left.expiresAt - right.expiresAt);
    for (const challenge of pending.slice(0, Math.max(0, pending.length - MAX_CHALLENGES_PER_DEVICE + 1))) {
      this.#challenges.delete(challenge.id);
    }
  }

  async #persist(): Promise<void> {
    if (this.#filePath === undefined) return;
    const payload: RegistryFile = { version: 3, devices: [...this.#devices.values()], pairings: [...this.#pairings.values()] };
    const filePath = this.#filePath;
    const temporary = `${filePath}.tmp`;
    this.#writeChain = this.#writeChain.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      await writeFile(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
      await rename(temporary, filePath);
      await chmod(filePath, 0o600);
    });
    await this.#writeChain;
  }
}

function publicDevice(device: Device): Omit<Device, "tokenHash"> {
  const { tokenHash: _tokenHash, ...safe } = device;
  return safe;
}

function bearerToken(authorization: string | undefined): string | null {
  return authorization?.startsWith("Bearer ") === true ? authorization.slice("Bearer ".length) : null;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validPublicKey(publicKeySpki: string): boolean {
  try {
    if (publicKeySpki.length < 64 || publicKeySpki.length > 512 || !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKeySpki)) return false;
    const key = createPublicKey({ key: Buffer.from(publicKeySpki, "base64"), format: "der", type: "spki" });
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

function validSignature(publicKeySpki: string, nonce: string, signature: string): boolean {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
    const publicKey = createPublicKey({ key: Buffer.from(publicKeySpki, "base64"), format: "der", type: "spki" });
    return verify("sha256", Buffer.from(nonce, "base64url"), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("request_body_too_large");
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_json");
  return value as Record<string, unknown>;
}

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(`${JSON.stringify(body)}\n`);
}
