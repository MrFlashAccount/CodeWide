import type { File } from "expo-file-system";
import { NativeModules, Platform } from "react-native";

import type { SavedServerId } from "../../domain/ids";

interface AttachmentNativeBridge {
  companionHttpOrigin(savedServerId: string): Promise<string>;
  hashContentDocument?(uri: string): Promise<NativeDocumentDigest>;
  mintStoredSession(savedServerId: string): Promise<SessionCredential>;
}

interface NativeDocumentDigest {
  bytes: number;
  sha256: string;
}

interface SessionCredential {
  expiresAt: number;
  sessionToken: string;
}

interface AttachmentUploadRequest {
  expectedBytes: number;
  file: File;
  mediaType: string;
  onProgress(transferredBytes: number): void;
  path: string;
  savedServerId: SavedServerId;
  sha256: string;
  signal: AbortSignal;
}

const bridge = NativeModules["CodeWideNative"] as AttachmentNativeBridge | undefined;

export async function authorizedAttachmentFetch(
  savedServerId: SavedServerId,
  path: string,
  init: RequestInit,
): Promise<Response> {
  requireAttachmentPath(path);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const access = await privateAccess(savedServerId);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${access.credential.sessionToken}`);
    const response = await fetch(`${access.origin}${path}`, { ...init, headers });
    if (attempt === 0 && isAuthorizationFailure(response.status)) continue;
    return response;
  }
  throw new Error("Private attachment authorization did not recover");
}

export async function authorizedAttachmentUpload(
  request: AttachmentUploadRequest,
): Promise<Response> {
  requireAttachmentPath(request.path);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const access = await privateAccess(request.savedServerId);
    const response = await xhrUpload(request, access);
    if (attempt === 0 && isAuthorizationFailure(response.status)) continue;
    return response;
  }
  throw new Error("Private attachment authorization did not recover");
}

export async function hashContentDocument(uri: string): Promise<NativeDocumentDigest | null> {
  if (!uri.startsWith("content://")) return null;
  const hash = requireBridge().hashContentDocument;
  if (hash === undefined) throw new Error("This attachment requires a newer CodeWide APK");
  const result = await hash(uri);
  if (
    !Number.isSafeInteger(result.bytes) ||
    result.bytes < 0 ||
    !/^[a-f0-9]{64}$/u.test(result.sha256)
  ) {
    throw new Error("Native attachment digest is invalid");
  }
  return result;
}

export function requireAttachmentPath(path: string): void {
  if (path === "/v2/attachments") return;
  if (!/^\/v2\/attachments\/[A-Za-z0-9._~-]+$/u.test(path)) {
    throw new Error("Attachment upload path is invalid");
  }
}

async function privateAccess(savedServerId: SavedServerId) {
  const [origin, credential] = await Promise.all([
    requireBridge().companionHttpOrigin(savedServerId),
    requireBridge().mintStoredSession(savedServerId),
  ]);
  if (!/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}$/u.test(origin)) {
    throw new Error("Private attachment transport returned an invalid origin");
  }
  if (credential.sessionToken === "" || !Number.isSafeInteger(credential.expiresAt)) {
    throw new Error("Private attachment session is invalid");
  }
  return { credential, origin };
}

function xhrUpload(
  request: AttachmentUploadRequest,
  access: Awaited<ReturnType<typeof privateAccess>>,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      request.signal.removeEventListener("abort", abort);
      action();
    };
    const abort = () => {
      xhr.abort();
      finish(() => reject(new Error("Attachment upload was cancelled")));
    };
    xhr.open("PUT", `${access.origin}${request.path}`);
    xhr.setRequestHeader("authorization", `Bearer ${access.credential.sessionToken}`);
    xhr.setRequestHeader("content-type", request.mediaType);
    xhr.setRequestHeader("x-content-sha256", request.sha256);
    xhr.upload.onprogress = (event) => {
      request.onProgress(Math.min(request.expectedBytes, event.loaded));
    };
    xhr.onerror = () => finish(() => reject(new Error("Attachment upload transport failed")));
    xhr.onabort = () => finish(() => reject(new Error("Attachment upload was cancelled")));
    xhr.onload = () =>
      finish(() =>
        resolve(
          new Response(typeof xhr.responseText === "string" ? xhr.responseText : "", {
            status: xhr.status,
            statusText: xhr.statusText,
          }),
        ),
      );
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    else xhr.send(request.file);
  });
}

function isAuthorizationFailure(status: number): boolean {
  return status === 401 || status === 403;
}

function requireBridge(): AttachmentNativeBridge {
  if (Platform.OS !== "android" || bridge === undefined) {
    throw new Error("Private attachment transport is unavailable");
  }
  return bridge;
}
