import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { DeviceScope } from "./capabilities.js";

const MATERIALIZE_PATH = "/v1/media/materialize";
const MEDIA_PREFIX = "/v1/media/";
const MAX_REQUEST_BYTES = 20 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
const REQUIRED_SCOPE: DeviceScope = "files.download.workspace";

type CachedImage = {
  id: string;
  sourceUrl: string;
  bytes: Buffer;
  contentType: string;
  expiresAt: number;
  lastAccessAt: number;
};

export class MediaProxyService {
  readonly #authorize: (authorization: string | undefined, requiredScope: DeviceScope) => boolean;
  readonly #images = new Map<string, CachedImage>();
  readonly #idsByUrl = new Map<string, string>();
  #cacheBytes = 0;

  constructor(authorize: (authorization: string | undefined, requiredScope: DeviceScope) => boolean) {
    this.#authorize = authorize;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (requestUrl.pathname !== MATERIALIZE_PATH && !requestUrl.pathname.startsWith(MEDIA_PREFIX)) return false;
    if (!this.#authorize(request.headers.authorization, REQUIRED_SCOPE) || request.headers.origin !== undefined) {
      json(response, 401, { error: "unauthorized" });
      return true;
    }
    try {
      if (requestUrl.pathname === MATERIALIZE_PATH) {
        if (request.method !== "POST") json(response, 405, { error: "method_not_allowed" });
        else await this.#materialize(request, response);
      } else if (request.method === "GET" || request.method === "HEAD") {
        this.#serve(request, response, requestUrl.pathname.slice(MEDIA_PREFIX.length));
      } else {
        json(response, 405, { error: "method_not_allowed" });
      }
    } catch (cause) {
      const error = cause instanceof MediaProxyError ? cause : new MediaProxyError(502, "image_fetch_failed");
      json(response, error.statusCode, { error: error.message });
    }
    return true;
  }

  close(): void {
    this.#images.clear();
    this.#idsByUrl.clear();
    this.#cacheBytes = 0;
  }

  async #materialize(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request);
    if (typeof body.url !== "string" || body.url.length > 16_384) throw new MediaProxyError(400, "valid_url_required");
    const sourceUrl = canonicalRemoteImageUrl(body.url);
    this.#evictExpired();
    const existingId = this.#idsByUrl.get(sourceUrl);
    const existing = existingId === undefined ? undefined : this.#images.get(existingId);
    if (existing !== undefined) {
      existing.lastAccessAt = Date.now();
      json(response, 200, { id: existing.id, expiresAt: existing.expiresAt });
      return;
    }
    const downloaded = await downloadImage(sourceUrl, 0);
    this.#makeRoom(downloaded.bytes.length);
    const id = randomBytes(24).toString("base64url");
    const now = Date.now();
    const image: CachedImage = {
      id,
      sourceUrl,
      bytes: downloaded.bytes,
      contentType: downloaded.contentType,
      expiresAt: now + CACHE_TTL_MS,
      lastAccessAt: now,
    };
    this.#images.set(id, image);
    this.#idsByUrl.set(sourceUrl, id);
    this.#cacheBytes += image.bytes.length;
    json(response, 201, { id, expiresAt: image.expiresAt });
  }

  #serve(request: IncomingMessage, response: ServerResponse, id: string): void {
    if (!/^[A-Za-z0-9_-]{32}$/.test(id)) throw new MediaProxyError(404, "image_not_found");
    const image = this.#images.get(id);
    if (image === undefined || image.expiresAt <= Date.now()) {
      if (image !== undefined) this.#delete(image);
      throw new MediaProxyError(404, "image_not_found");
    }
    image.lastAccessAt = Date.now();
    response.writeHead(200, {
      "content-type": image.contentType,
      "content-length": String(image.bytes.length),
      "cache-control": "private, max-age=300",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    response.end(request.method === "HEAD" ? undefined : image.bytes);
  }

  #evictExpired(): void {
    const now = Date.now();
    for (const image of this.#images.values()) if (image.expiresAt <= now) this.#delete(image);
  }

  #makeRoom(incomingBytes: number): void {
    if (incomingBytes > MAX_CACHE_BYTES) throw new MediaProxyError(413, "image_too_large");
    this.#evictExpired();
    const oldest = [...this.#images.values()].sort((left, right) => left.lastAccessAt - right.lastAccessAt);
    for (const image of oldest) {
      if (this.#cacheBytes + incomingBytes <= MAX_CACHE_BYTES) break;
      this.#delete(image);
    }
  }

  #delete(image: CachedImage): void {
    this.#images.delete(image.id);
    if (this.#idsByUrl.get(image.sourceUrl) === image.id) this.#idsByUrl.delete(image.sourceUrl);
    this.#cacheBytes -= image.bytes.length;
  }
}

async function downloadImage(rawUrl: string, redirectCount: number): Promise<{ bytes: Buffer; contentType: string }> {
  if (redirectCount > MAX_REDIRECTS) throw new MediaProxyError(400, "too_many_redirects");
  const url = new URL(canonicalRemoteImageUrl(rawUrl));
  const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some((entry) => blockedAddresses.check(entry.address, entry.family === 4 ? "ipv4" : "ipv6"))) {
    throw new MediaProxyError(400, "unsafe_image_host");
  }
  const selected = addresses[0]!;
  return await new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: "GET",
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
        "user-agent": "CodeWide-Media/1",
      },
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
    }, (response) => {
      const status = response.statusCode ?? 500;
      if (status >= 300 && status < 400) {
        response.resume();
        const location = response.headers.location;
        if (location === undefined) {
          reject(new MediaProxyError(502, "redirect_without_location"));
          return;
        }
        void downloadImage(new URL(location, url).toString(), redirectCount + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new MediaProxyError(502, "image_upstream_failed"));
        return;
      }
      const declaredLength = Number(response.headers["content-length"] ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
        response.destroy();
        reject(new MediaProxyError(413, "image_too_large"));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_IMAGE_BYTES) {
          response.destroy(new MediaProxyError(413, "image_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => {
        const bytes = Buffer.concat(chunks, total);
        const contentType = detectImageType(bytes);
        if (contentType === null) reject(new MediaProxyError(415, "unsupported_image"));
        else resolve({ bytes, contentType });
      });
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new MediaProxyError(504, "image_fetch_timeout")));
    request.once("error", reject);
    request.end();
  });
}

function canonicalRemoteImageUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MediaProxyError(400, "valid_url_required");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || (url.port !== "" && url.port !== "443")) {
    throw new MediaProxyError(400, "https_image_required");
  }
  url.hash = "";
  return url.toString();
}

function detectImageType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp" && ["avif", "avis"].includes(bytes.subarray(8, 12).toString("ascii"))) return "image/avif";
  return null;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_REQUEST_BYTES) throw new MediaProxyError(413, "request_too_large");
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new MediaProxyError(400, "valid_json_required");
  }
}

function json(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
}

class MediaProxyError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blockedAddresses.addSubnet(network, prefix, "ipv6");
