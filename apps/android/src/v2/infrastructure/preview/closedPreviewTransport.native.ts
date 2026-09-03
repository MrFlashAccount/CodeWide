import { toByteArray } from "base64-js";
import { File } from "expo-file-system";
import type {
  V2MediaMaterializeResponse,
  V2MediaStreamCreateResponse,
} from "@codewide/sync-client/v2";
import { NativeModules, Platform } from "react-native";

import type {
  PreviewFileRequest,
  PreviewStreamSource,
  PreviewTransport,
  PreviewMode,
} from "../../application/preview/previewTransport";
import { MAX_DOCUMENT_PREVIEW_BYTES } from "../../application/preview/previewTransport";
import type { SavedServerId } from "../../domain/ids";
import { acquireSharedConnectionLease } from "../connection/sharedConnectionAdapter.native";
import {
  exportPreviewFile,
  materializePreviewFile,
  savePreviewFile,
} from "./previewFileTransfer.native";

interface PreviewNativeBridge {
  companionHttpOrigin(connectionId: string): Promise<string>;
  mintStoredSession(connectionId: string): Promise<{ expiresAt: number; sessionToken: string }>;
}

const bridge = NativeModules["CodeWideNative"] as PreviewNativeBridge | undefined;

export function createClosedPreviewTransport(): PreviewTransport {
  return {
    async exportFile(request) {
      return exportPreviewFile({ request, source: await streamForFile(request) });
    },
    async materialize(request) {
      return materializePreviewFile({ request, source: await streamForFile(request) });
    },
    async read(savedServerId, sourceUrl) {
      if (localSource(sourceUrl)) {
        const file = new File(sourceUrl);
        return { bodyBase64: await file.base64(), contentType: file.type };
      }
      const connection = await acquireSharedConnectionLease(savedServerId);
      try {
        const response = sourceUrl.startsWith("/v2/files/preview?")
          ? await connection.lease.request("files-v2", resolveFilePreview(sourceUrl))
          : await readRemoteDocument(connection.lease, sourceUrl);
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`Preview returned ${response.status}`);
        }
        return { bodyBase64: response.bodyBase64, contentType: response.contentType };
      } finally {
        await connection.lease.release();
      }
    },
    async save(request) {
      return savePreviewFile({ request, source: await streamForFile(request) });
    },
    async stream(savedServerId, sourceUrl, mode) {
      return resolveStream(savedServerId, sourceUrl, mode);
    },
  };
}

async function streamForFile(request: PreviewFileRequest): Promise<PreviewStreamSource> {
  return resolveStream(request.savedServerId, request.sourceUrl, request.mode);
}

async function resolveStream(
  savedServerId: SavedServerId,
  sourceUrl: string,
  mode: PreviewMode,
): Promise<PreviewStreamSource> {
  if (localSource(sourceUrl)) return { headers: null, uri: sourceUrl };
  if (sourceUrl.startsWith("/v2/tunnels/")) return authorizedSource(savedServerId, sourceUrl);
  if (sourceUrl.startsWith("/v2/files/preview?")) {
    resolveFilePreview(sourceUrl);
    return authorizedSource(savedServerId, sourceUrl);
  }
  const connection = await acquireSharedConnectionLease(savedServerId);
  let relativeUrl: string;
  try {
    const media = await registerRemoteMedia(connection.lease, sourceUrl, mode);
    const prefix = mode === "image" ? "/v2/media/" : "/v2/media/streams/";
    relativeUrl = `${prefix}${encodeURIComponent(media.id)}`;
  } finally {
    await connection.lease.release();
  }
  return authorizedSource(savedServerId, relativeUrl);
}

function resolveFilePreview(sourceUrl: string): {
  head: false;
  operation: "file.preview";
  path: string;
} {
  if (!sourceUrl.startsWith("/v2/files/preview?")) {
    throw new Error("Remote document previews are unavailable");
  }
  const path = new URL(sourceUrl, "http://codewide.local").searchParams.get("path");
  if (path === null || path === "") throw new Error("Attachment path is invalid");
  return { head: false, operation: "file.preview", path };
}

async function registerRemoteMedia(
  lease: Awaited<ReturnType<typeof acquireSharedConnectionLease>>["lease"],
  sourceUrl: string,
  mode: PreviewMode,
): Promise<V2MediaMaterializeResponse | V2MediaStreamCreateResponse> {
  if (!secureRemoteSource(sourceUrl)) throw new Error("Attachment source must use HTTPS");
  const streaming = mode !== "image";
  const response = await lease.request("media-v2", {
    operation: streaming ? "media.streamCreate" : "media.materialize",
    sourceUrl,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Media registration returned ${response.status}`);
  }
  const value = JSON.parse(new TextDecoder().decode(toByteArray(response.bodyBase64))) as unknown;
  return parseMedia(value);
}

async function readRemoteDocument(
  lease: Awaited<ReturnType<typeof acquireSharedConnectionLease>>["lease"],
  sourceUrl: string,
): ReturnType<Awaited<ReturnType<typeof acquireSharedConnectionLease>>["lease"]["request"]> {
  const media = await registerRemoteMedia(lease, sourceUrl, "document");
  return lease.request("media-v2", {
    head: false,
    id: media.id,
    limit: MAX_DOCUMENT_PREVIEW_BYTES + 1,
    offset: 0,
    operation: "media.streamRead",
  });
}

async function authorizedSource(
  savedServerId: SavedServerId,
  relativeUrl: string,
): Promise<PreviewStreamSource> {
  const [origin, session] = await Promise.all([
    companionHttpOrigin(savedServerId),
    mintStoredSession(savedServerId),
  ]);
  return {
    headers: { Authorization: `Bearer ${session.sessionToken}` },
    uri: `${origin}${relativeUrl}`,
  };
}

async function companionHttpOrigin(savedServerId: SavedServerId): Promise<string> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Private preview transport is unavailable");
  }
  const origin = await bridge.companionHttpOrigin(savedServerId);
  if (!/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}$/u.test(origin)) {
    throw new Error("Private preview transport returned an invalid origin");
  }
  return origin;
}

async function mintStoredSession(
  savedServerId: SavedServerId,
): Promise<{ expiresAt: number; sessionToken: string }> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Private preview session is unavailable");
  }
  const session = await bridge.mintStoredSession(savedServerId);
  if (
    typeof session.sessionToken !== "string" ||
    session.sessionToken === "" ||
    !Number.isSafeInteger(session.expiresAt)
  ) {
    throw new Error("Private preview session is invalid");
  }
  return session;
}

function parseMedia(value: unknown): V2MediaMaterializeResponse | V2MediaStreamCreateResponse {
  if (value === null || typeof value !== "object") throw new Error("Media response is invalid");
  const id = Reflect.get(value, "id");
  const expiresAt = Reflect.get(value, "expiresAt");
  if (typeof id !== "string" || id === "" || !Number.isSafeInteger(expiresAt)) {
    throw new Error("Media response is invalid");
  }
  return { expiresAt, id };
}

function localSource(value: string): boolean {
  return value.startsWith("file:") || value.startsWith("content:");
}

function secureRemoteSource(value: string): boolean {
  return value.startsWith("https://");
}
