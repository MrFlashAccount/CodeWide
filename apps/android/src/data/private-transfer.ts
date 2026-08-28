export type TransferAccess = { baseUrl: string; authorization: string };
export type GetTransferAccess = (forceRefresh?: boolean) => Promise<TransferAccess>;

export type PrivateAssetSource =
  | { kind: "direct"; uri: string; headers?: Record<string, string> }
  | { kind: "path"; path: string }
  | { kind: "content"; id: string }
  | { kind: "remote"; url: string }
  | { kind: "scoped"; rootId: string; path: string; cacheRevision?: string };

export type PrivateAssetTextResult = {
  text: string;
  contentType: string | null;
  totalBytes: number | null;
  nextOffset: number;
  truncated: boolean;
};

type TransferRequest = { uri: string; init?: RequestInit };

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
      headers: mergeHeaders(
        { authorization: access.authorization },
        request.init?.headers,
      ),
    });
    if (attempt === 0 && isAuthorizationStatus(response.status)) continue;
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
    return await fetch(source.uri, {
      ...init,
      headers: mergeHeaders(source.headers, init.headers),
    });
  }
  if (getAccess === null) throw new Error("Private asset access is unavailable");
  const resolved = source.kind === "remote"
    ? await materializeRemoteAsset(source.url, getAccess)
    : source;
  return await fetchAuthenticatedTransfer(getAccess, (access) => ({
    uri: privateAssetUrl(resolved, access),
    init,
  }));
}

export async function fetchScopedUpload(
  rootId: string,
  path: string,
  getAccess: GetTransferAccess,
  init: RequestInit,
): Promise<Response> {
  return await fetchAuthenticatedTransfer(getAccess, (access) => ({
    uri: scopedTransferUrl(access, "/v1/files/upload", rootId, path),
    init,
  }));
}

export async function readPrivateAssetText(
  source: PrivateAssetSource,
  getAccess: GetTransferAccess | null,
  options: {
    offset?: number;
    limit?: number;
    accept?: string;
    signal?: AbortSignal;
  } = {},
): Promise<PrivateAssetTextResult> {
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = options.limit === undefined ? null : Math.max(1, Math.floor(options.limit));
  const range = limit === null ? null : `bytes=${offset}-${offset + limit - 1}`;
  const response = await fetchPrivateAsset(source, getAccess, {
    headers: {
      ...(options.accept === undefined ? {} : { accept: options.accept }),
      ...(range === null ? {} : { range }),
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240).trim();
    if (response.status === 404 && source.kind === "path") throw new Error("File was deleted");
    throw new Error(`Private content unavailable (${response.status})${detail === "" ? "" : `: ${detail}`}`);
  }
  const text = await response.text();
  const encodedBytes = new TextEncoder().encode(text).byteLength;
  const rangeInfo = parseContentRange(response.headers.get("content-range"));
  const totalBytes = rangeInfo?.total ?? parseContentLength(response.headers.get("content-length"));
  const nextOffset = rangeInfo?.endExclusive ?? offset + encodedBytes;
  return {
    text,
    contentType: response.headers.get("content-type"),
    totalBytes,
    nextOffset,
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
): Promise<{ uri: string; headers: Record<string, string> }> {
  const resolved = source.kind === "remote"
    ? await materializeRemoteAsset(source.url, getAccess)
    : source;
  const access = await getAccess(forceRefresh);
  return {
    uri: privateAssetUrl(resolved, access),
    headers: { authorization: access.authorization },
  };
}

export function privateAssetCacheKey(source: PrivateAssetSource): string {
  if (source.kind === "direct") return `direct:${source.uri}`;
  if (source.kind === "path") return `path:${source.path}`;
  if (source.kind === "content") return `content:${source.id}`;
  if (source.kind === "scoped") return `scoped:${source.rootId}:${source.path}:${source.cacheRevision ?? "0"}`;
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
    if (!source.path.startsWith("/") || source.path.includes("\0")) throw new Error("Private file path must be absolute");
    const url = companionUrl(access, "/v1/files/preview");
    url.search = new URLSearchParams({ path: source.path }).toString();
    return url.toString();
  }
  if (source.kind === "content") {
    if (!/^[a-f0-9]{64}$/u.test(source.id)) throw new Error("Private asset reference is invalid");
    return companionUrl(access, `/v1/content/${source.id}`).toString();
  }
  const url = new URL(scopedTransferUrl(access, "/v1/files/download", source.rootId, source.path));
  if (source.cacheRevision !== undefined) url.searchParams.set("v", source.cacheRevision);
  return url.toString();
}

async function materializeRemoteAsset(url: string, getAccess: GetTransferAccess): Promise<{ kind: "content"; id: string }> {
  const response = await fetchAuthenticatedTransfer(getAccess, (access) => ({
    uri: companionUrl(access, "/v1/media/materialize").toString(),
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    },
  }));
  if (!response.ok) throw new Error(`Private asset materialization failed (${response.status})`);
  const body = await response.json() as { id?: unknown };
  if (typeof body.id !== "string" || !/^[a-f0-9]{64}$/u.test(body.id)) throw new Error("Private asset response is invalid");
  return { kind: "content", id: body.id };
}

function companionUrl(access: TransferAccess, path: string): URL {
  const url = new URL(access.baseUrl);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url;
}

function validateScopedPath(rootId: string, path: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(rootId)) throw new Error("Invalid file root id");
  if (path.length === 0 || path.startsWith("/") || path.includes("\0")) throw new Error("Remote path must be relative");
}

function isAuthorizationStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function mergeHeaders(base: HeadersInit | undefined, override: HeadersInit | undefined): Headers {
  const headers = new Headers(base);
  new Headers(override).forEach((value, key) => headers.set(key, value));
  return headers;
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseContentRange(value: string | null): { endExclusive: number; total: number | null } | null {
  if (value === null) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/u.exec(value);
  if (match === null) return null;
  const end = Number(match[2]);
  const total = match[3] === "*" ? null : Number(match[3]);
  if (!Number.isSafeInteger(end) || end < 0 || (total !== null && (!Number.isSafeInteger(total) || total < 0))) return null;
  return { endExclusive: end + 1, total };
}
