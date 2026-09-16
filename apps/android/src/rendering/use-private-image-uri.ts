import { createContext, createElement, type ReactNode, useContext } from "react";

import type { GetTransferAccess, PrivateAssetSource } from "../data/private-transfer";
import { materializePrivateAsset } from "./private-asset";
import { useEphemeralAsyncResource } from "./async-resource-store";
import { privateImageResourceKey } from "./private-image-resource-key";
import { incrementMetric, recordTiming } from "../data/operational-metrics";

type ResolvedImageSource = { headers?: Record<string, string>; uri: string };
type PrivateImageSource = {
  failed: boolean;
  headers?: Record<string, string>;
  source: ResolvedImageSource | null;
  uri: string | null;
};
const PrivateImageAccessContext = createContext<GetTransferAccess | null>(null);
const PrivateFileAccessScopeContext = createContext("none");
const PrivateAssetRecoveryContext = createContext<(() => Promise<void>) | null>(null);
const EMPTY_PRIVATE_IMAGE: PrivateImageSource = { failed: false, source: null, uri: null };
const FAILED_PRIVATE_IMAGE: PrivateImageSource = { failed: true, source: null, uri: null };

export function PrivateImageAccessProvider({
  children,
  getAccess,
  scope,
}: {
  children: ReactNode;
  getAccess?: GetTransferAccess;
  scope: string;
}) {
  return createElement(
    PrivateFileAccessScopeContext.Provider,
    { value: scope },
    createElement(PrivateImageAccessContext.Provider, { value: getAccess ?? null }, children),
  );
}

export function PrivateAssetRecoveryProvider({
  children,
  recover,
}: {
  children: ReactNode;
  recover?: () => Promise<void>;
}) {
  return createElement(PrivateAssetRecoveryContext.Provider, { value: recover ?? null }, children);
}

export function usePrivateFileAccessScope(): string {
  return useContext(PrivateFileAccessScopeContext);
}

export function usePrivateImageUri(
  sourceUri: string | null,
  sourceHeaders?: Record<string, string>,
  revision = 0,
): PrivateImageSource {
  const source = sourceUri === null ? null : imageAssetSource(sourceUri, sourceHeaders);
  return usePrivateAssetUri(source, revision);
}

export function usePrivateAssetUri(
  source: PrivateAssetSource | null,
  revision = 0,
  accessOverride?: GetTransferAccess,
): PrivateImageSource {
  const inheritedAccess = useContext(PrivateImageAccessContext);
  const recoverMissing = useContext(PrivateAssetRecoveryContext);
  const getAccess = accessOverride ?? inheritedAccess;
  const accessScope = usePrivateFileAccessScope();
  const key =
    source === null
      ? null
      : `private-asset:${accessScope}:${String(revision)}:${privateImageResourceKey(source)}`;
  const resource = useEphemeralAsyncResource<PrivateImageSource>(
    key,
    key ?? "none",
    async (_publish, signal) => {
      if (source === null) {
        return EMPTY_PRIVATE_IMAGE;
      }
      const materialize = materializePrivateAsset(
        source,
        getAccess,
        recoverMissing ?? undefined,
        signal,
      );
      const materializeStartedAt = performance.now();
      return materialize.then(
        (resolved) => {
          if (!signal.aborted) {
            recordTiming("image_materialize_ms", performance.now() - materializeStartedAt);
          }
          return {
            failed: false,
            headers: resolved.headers,
            source: { headers: resolved.headers, uri: resolved.uri },
            uri: resolved.uri,
          };
        },
        (error: unknown) => {
          if (!(error instanceof Error && error.name === "AbortError")) {
            incrementMetric("image_failures");
          }
          throw error instanceof Error ? error : new Error("Private image request failed");
        },
      );
    },
  );
  if (resource.status === "error") {
    return FAILED_PRIVATE_IMAGE;
  }
  return resource.value ?? EMPTY_PRIVATE_IMAGE;
}

function imageAssetSource(uri: string, headers?: Record<string, string>): PrivateAssetSource {
  if (headers !== undefined) {
    return { headers, kind: "direct", uri };
  }
  try {
    const url = new URL(uri);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { kind: "remote", url: uri };
    }
  } catch {
    // Data and app-private file URIs are handled directly.
  }
  return { kind: "direct", uri };
}
