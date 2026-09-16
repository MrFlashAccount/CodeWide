import { cachedAttachmentFetch } from "../native/attachment-cache/cached-transfer";
import { companionHttpUrl } from "./companion-http-url";
import type { StoredConnection } from "./connection-profile-types";
import { unknownRecord } from "./unknownRecord";

export type TransferAccess = { authorization: string; baseUrl: string; cacheScope?: string };
export type GetTransferAccess = (forceRefresh?: boolean) => Promise<TransferAccess>;

export type PrivateAssetSource =
  | { headers?: Record<string, string>; kind: "direct"; uri: string }
  | { kind: "path"; path: string }
  | { id: string; kind: "content" }
  | { kind: "remote"; url: string }
  | { cacheRevision?: string; kind: "scoped"; path: string; rootId: string };

export type PrivateAssetTextResult = {
  contentType: string | null;
  nextOffset: number;
  text: string;
  totalBytes: number | null;
  truncated: boolean;
};

type TransferRequest = { init?: RequestInit; uri: string };

/**
 * The only authenticated HTTP boundary for private data. Callers describe a
 * source or destination; they never retain bearer tokens or companion URLs.
 * A rejected session is refreshed once for every operation, including upload
 * resume probes and ranged downloads.
 */
export async function fetchAuthenticatedTransfer(
  getAccess: GetTransferAccess,
  createRequest: (access: TransferAccess) => TransferRequest,
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const access = await getAccess(attempt > 0);
    const request = createRequest(access);
    const response = await fetch(request.uri, {
      ...request.init,
      headers: mergeHeaders({ authorization: access.authorization }, request.init?.headers),
    });
    if (attempt === 0 && isAuthorizationStatus(response.status)) {
      continue;
    }
    return response;
  }
  throw new Error("Private transfer authorization did not recover");
}

export async function fetchPrivateAsset(
  source: PrivateAssetSource,
  getAccess: GetTransferAccess | null,
  init: RequestInit = {},
): Promise<Response> {
  if (source.kind === "direct") {
    return cachedAttachmentFetch(
      source.uri,
      {
        ...init,
        headers: mergeHeaders(source.headers, init.headers),
      },
      { identity: source.uri, scope: "direct" },
    );
  }
  if (getAccess === null) {
    throw new Error("Private asset access is unavailable");
  }
  const resolved =
    source.kind === "remote" ? await materializeRemoteAsset(source.url, getAccess) : source;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const access = await getAccess(attempt > 0);
    const response = await cachedAttachmentFetch(
      privateAssetUrl(resolved, access),
      {
        ...init,
        headers: mergeHeaders({ authorization: access.authorization }, init.headers),
      },
      { identity: privateAssetCacheKey(resolved), scope: access.cacheScope ?? access.baseUrl },
    );
    if (attempt === 0 && isAuthorizationStatus(response.status)) {
      continue;
    }
    return response;
  }
  throw new Error("Private attachment authorization did not recover");
}

export async function fetchScopedUpload(
  rootId: string,
  path: string,
  getAccess: GetTransferAccess,
  init: RequestInit,
): Promise<Response> {
  return fetchAuthenticatedTransfer(getAccess, (access) => ({
    init,
    uri: scopedTransferUrl(access, "/v1/files/upload", rootId, path),
  }));
}

export async function readPrivateAssetText(
  source: PrivateAssetSource,
  getAccess: GetTransferAccess | null,
  options: {
    accept?: string;
    limit?: number;
    offset?: number;
    signal?: AbortSignal;
  } = {},
): Promise<PrivateAssetTextResult> {
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = options.limit === undefined ? null : Math.max(1, Math.floor(options.limit));
  const range = limit === null ? null : `bytes=${String(offset)}-${String(offset + limit - 1)}`;
  const response = await fetchPrivateAsset(source, getAccess, {
    headers: {
      ...(options.accept === undefined ? {} : { accept: options.accept }),
      ...(range === null ? {} : { range }),
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) {
    if (response.status === 404 && source.kind === "path") {
      throw new Error("File was deleted");
    }
    const detail = (await response.text()).slice(0, 240).trim();
    throw new Error(
      `Private content unavailable (${String(response.status)})${detail === "" ? "" : `: ${detail}`}`,
    );
  }
  const text = await response.text();
  const encodedBytes = new TextEncoder().encode(text).byteLength;
  const rangeInfo = parseContentRange(response.headers.get("content-range"));
  const totalBytes = rangeInfo?.total ?? parseContentLength(response.headers.get("content-length"));
  const nextOffset = rangeInfo?.endExclusive ?? offset + encodedBytes;
  return {
    contentType: response.headers.get("content-type"),
    nextOffset,
    text,
    totalBytes,
    truncated: totalBytes !== null && nextOffset < totalBytes,
  };
}

/** Resolve a private source for native streaming adapters such as Expo's
 * download task. The adapter still receives only an ephemeral request and
 * retries through this function after an authorization failure. */
export async function resolvePrivateAssetRequest(
  source: Exclude<PrivateAssetSource, { kind: "direct" }>,
  getAccess: GetTransferAccess,
  forceRefresh = false,
): Promise<{
  cacheIdentity: string;
  cacheScope: string;
  headers: Record<string, string>;
  uri: string;
}> {
  const resolved =
    source.kind === "remote" ? await materializeRemoteAsset(source.url, getAccess) : source;
  const access = await getAccess(forceRefresh);
  return {
    cacheIdentity: privateAssetCacheKey(resolved),
    cacheScope: access.cacheScope ?? access.baseUrl,
    headers: { authorization: access.authorization },
    uri: privateAssetUrl(resolved, access),
  };
}

export function privateAssetCacheKey(source: PrivateAssetSource): string {
  if (source.kind === "direct") {
    return `direct:${source.uri}`;
  }
  if (source.kind === "path") {
    return `path:${source.path}`;
  }
  if (source.kind === "content") {
    return `content:${source.id}`;
  }
  if (source.kind === "scoped") {
    return `scoped:${source.rootId}:${source.path}:${source.cacheRevision ?? "0"}`;
  }
  return `remote:${source.url}`;
}

function scopedTransferUrl(
  access: TransferAccess,
  endpoint: "/v1/files/upload" | "/v1/files/download",
  rootId: string,
  path: string,
): string {
  validateScopedPath(rootId, path);
  const url = companionUrl(access, endpoint);
  url.searchParams.set("rootId", rootId);
  url.searchParams.set("path", path);
  return url.toString();
}

function privateAssetUrl(
  source: Exclude<PrivateAssetSource, { kind: "direct" | "remote" }>,
  access: TransferAccess,
): string {
  if (source.kind === "path") {
    if (!source.path.startsWith("/") || source.path.includes("\0")) {
      throw new Error("Private file path must be absolute");
    }
    const url = companionUrl(access, "/v1/files/preview");
    url.search = new URLSearchParams({ path: source.path }).toString();
    return url.toString();
  }
  if (source.kind === "content") {
    if (!/^[a-f0-9]{64}$/u.test(source.id)) {
      throw new Error("Private asset reference is invalid");
    }
    return companionUrl(access, `/v1/content/${source.id}`).toString();
  }
  const url = new URL(scopedTransferUrl(access, "/v1/files/download", source.rootId, source.path));
  if (source.cacheRevision !== undefined) {
    url.searchParams.set("v", source.cacheRevision);
  }
  return url.toString();
}

async function materializeRemoteAsset(
  url: string,
  getAccess: GetTransferAccess,
): Promise<{ id: string; kind: "content" }> {
  const response = await fetchAuthenticatedTransfer(getAccess, (access) => ({
    init: {
      body: JSON.stringify({ url }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
    uri: companionUrl(access, "/v1/media/materialize").toString(),
  }));
  if (!response.ok) {
    throw new Error(`Private asset materialization failed (${String(response.status)})`);
  }
  const body = unknownRecord(await response.json());
  if (body === null || typeof body.id !== "string" || !/^[a-f0-9]{64}$/u.test(body.id)) {
    throw new Error("Private asset response is invalid");
  }
  return { id: body.id, kind: "content" };
}

function companionUrl(access: TransferAccess, path: string): URL {
  return new URL(companionHttpUrl(access.baseUrl, path));
}

function validateScopedPath(rootId: string, path: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(rootId)) {
    throw new Error("Invalid file root id");
  }
  if (path.length === 0 || path.includes("\0")) {
    throw new Error("Remote path is invalid");
  }
}

function isAuthorizationStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function mergeHeaders(base: HeadersInit | undefined, override: HeadersInit | undefined): Headers {
  const headers = new Headers(base);
  new Headers(override).forEach((value, key) => {
    headers.set(key, value);
  });
  return headers;
}

function parseContentLength(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseContentRange(
  value: string | null,
): { endExclusive: number; total: number | null } | null {
  if (value === null) {
    return null;
  }
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/u.exec(value);
  if (match === null) {
    return null;
  }
  const end = Number(match[2]);
  const total = match[3] === "*" ? null : Number(match[3]);
  if (
    !Number.isSafeInteger(end) ||
    end < 0 ||
    (total !== null && (!Number.isSafeInteger(total) || total < 0))
  ) {
    return null;
  }
  return { endExclusive: end + 1, total };
}

/** Existing profile and native HTTP authorization owners used by private consumers. */
export type PrivateTransferAuthority = {
  currentConnections: () => StoredConnection[];
  nativeCompanionHttpOrigin: (connectionId: string, endpoint: string) => Promise<string>;
  scopedHttpAuthorization: (connection: StoredConnection, forceRefresh: boolean) => Promise<string>;
};

/** Returns qualified access without retaining credentials in the feature. */
export function createPrivateTransferAccess({
  currentConnections,
  nativeCompanionHttpOrigin,
  scopedHttpAuthorization,
}: PrivateTransferAuthority) {
  const transferAccess = async (
    connectionId: string,
    forceRefresh = false,
  ): Promise<TransferAccess> => {
    const connection = currentConnections().find((candidate) => candidate.id === connectionId);
    if (connection === undefined) {
      throw new Error("Connection not found");
    }
    const origin = await nativeCompanionHttpOrigin(connection.id, connection.endpoint);
    return {
      authorization: await scopedHttpAuthorization(connection, forceRefresh),
      baseUrl: companionHttpUrl(origin, "/"),
      cacheScope: connection.id,
    };
  };
  return transferAccess;
}
