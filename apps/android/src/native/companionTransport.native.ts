import { NativeModules } from "react-native";

import type { StoredConnection } from "../data/connection-profile-types";
import { unknownRecord } from "../data/unknownRecord";
import {
  transportResponse,
  type CompanionConnectionTransport,
  type CompanionTransport,
  type CompanionTransportBody,
} from "./companionTransportContract";
import { checkAborted } from "./check-aborted";

type NativeHeaders = ReadonlyArray<readonly [string, string]>;

type NativePayload =
  | { readonly bytes: number; readonly kind: "file" }
  | { readonly kind: "none" }
  | { readonly kind: "text"; readonly text: string };

type NativeResult = {
  readonly headers: NativeHeaders;
  readonly payload: NativePayload;
  readonly status: number;
};

type NativeSink =
  | { readonly append: boolean; readonly kind: "file"; readonly uri: string }
  | { readonly kind: "discard" }
  | { readonly kind: "text" };

type CompanionHttpBridge = {
  companionHttpCancel?: (requestId: string) => void;
  companionHttpRequest?: (requestJson: string) => Promise<unknown>;
};

// WHY: React Native's module registry exposes the installed native bridge as any and has no
// generated TypeScript declaration; every result is validated by `nativeResult` below.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const bridge = NativeModules.CodeWideNative as CompanionHttpBridge | undefined;

/**
 * Companion addresses never resolve on the network. The native client owns the
 * pinned origin, and the same address loads in image and video views because
 * `CompanionAddressInterceptor` routes it inside React Native's HTTP clients.
 */
const COMPANION_ADDRESS_ORIGIN = "https://companion.invalid";

let requestSequence = 0;
const REQUEST_ID_RADIX = 36;
const HEADER_ENTRY_LENGTH = 2;

/** Routes Companion HTTP through the native pinned client instead of a loopback proxy. */
export function companionConnectionTransport(
  connection: Pick<StoredConnection, "endpoint" | "id">,
): CompanionConnectionTransport {
  const baseUrl = `${COMPANION_ADDRESS_ORIGIN}/${encodeURIComponent(connection.id)}`;
  const transport: CompanionTransport = {
    async download(uri, init, destination) {
      const result = await request(connection.id, {
        baseUrl,
        body: undefined,
        headers: new Headers(init.headers),
        method: "GET",
        signal: init.signal,
        sink: { append: destination.append, kind: "file", uri: destination.uri },
        uri,
      });
      return { headers: nativeHeaders(result.headers), status: result.status };
    },
    async fetch(uri, init = {}) {
      const method = (init.method ?? "GET").toUpperCase();
      const result = await request(connection.id, {
        baseUrl,
        body: init.body,
        headers: new Headers(init.headers),
        method,
        signal: init.signal,
        sink: method === "HEAD" ? { kind: "discard" } : { kind: "text" },
        uri,
      });
      return transportResponse(
        result.status,
        nativeHeaders(result.headers),
        result.payload.kind === "text" ? result.payload.text : null,
      );
    },
    // Image and video views load the Companion address itself; native routing streams it.
    async streamSource(uri, headers) {
      await Promise.resolve();
      companionPath(baseUrl, uri);
      return { headers, uri };
    },
  };
  return { baseUrl, transport };
}

async function request(
  connectionId: string,
  {
    baseUrl,
    body,
    headers,
    method,
    signal,
    sink,
    uri,
  }: {
    readonly baseUrl: string;
    readonly body: CompanionTransportBody | undefined;
    readonly headers: Headers;
    readonly method: string;
    readonly signal: AbortSignal | undefined;
    readonly sink: NativeSink;
    readonly uri: string;
  },
): Promise<NativeResult> {
  const send = bridge?.companionHttpRequest;
  if (send === undefined) {
    throw new Error("Companion HTTP transport is unavailable in this build");
  }
  if (signal !== undefined) {
    checkAborted(signal);
  }
  requestSequence += 1;
  const requestId = `r${Date.now().toString(REQUEST_ID_RADIX)}-${requestSequence.toString(REQUEST_ID_RADIX)}`;
  const cancel = () => bridge?.companionHttpCancel?.(requestId);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return nativeResult(
      await send(
        JSON.stringify({
          body: nativeBody(body),
          connectionId,
          headers: [...headers.entries()],
          method,
          path: companionPath(baseUrl, uri),
          requestId,
          sink,
        }),
      ),
    );
  } catch (error) {
    if (signal !== undefined) {
      checkAborted(signal);
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

function nativeBody(body: CompanionTransportBody | undefined) {
  if (body === undefined) {
    return { kind: "none" };
  }
  if (typeof body === "string") {
    return { kind: "text", text: body };
  }
  return body;
}

function companionPath(baseUrl: string, uri: string): string {
  if (!uri.startsWith(`${baseUrl}/`)) {
    throw new Error("Companion HTTP address does not belong to this transport");
  }
  return uri.slice(baseUrl.length);
}

function nativeHeaders(entries: NativeHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of entries) {
    headers.append(name, value);
  }
  return headers;
}

function nativeResult(value: unknown): NativeResult {
  const record = unknownRecord(value);
  if (record === null) {
    throw new Error("Companion HTTP result is invalid");
  }
  const { headers, payload, status } = record;
  if (
    typeof status !== "number" ||
    !Number.isInteger(status) ||
    !Array.isArray(headers) ||
    !headers.every(isHeaderEntry)
  ) {
    throw new Error("Companion HTTP result is invalid");
  }
  return { headers, payload: nativePayload(payload), status };
}

function isHeaderEntry(value: unknown): value is readonly [string, string] {
  return (
    Array.isArray(value) &&
    value.length === HEADER_ENTRY_LENGTH &&
    typeof value[0] === "string" &&
    typeof value[1] === "string"
  );
}

function nativePayload(value: unknown): NativePayload {
  const record = unknownRecord(value);
  const payload = record === null ? null : (nativeTextOrEmpty(record) ?? nativeFile(record));
  if (payload === null) {
    throw new Error("Companion HTTP payload is invalid");
  }
  return payload;
}

function nativeTextOrEmpty(record: Record<string, unknown>): NativePayload | null {
  if (record.kind === "none") {
    return { kind: "none" };
  }
  return record.kind === "text" && typeof record.text === "string"
    ? { kind: "text", text: record.text }
    : null;
}

function nativeFile(record: Record<string, unknown>): NativePayload | null {
  const { bytes } = record;
  return record.kind === "file" &&
    typeof bytes === "number" &&
    Number.isSafeInteger(bytes) &&
    bytes >= 0
    ? { bytes, kind: "file" }
    : null;
}
