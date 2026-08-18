import { createContext, createElement, type ReactNode, useContext } from "react";

import {
  privateAssetCacheKey,
  type GetTransferAccess,
  type PrivateAssetSource,
} from "../data/private-transfer";
import { materializePrivateAsset } from "./private-asset";
import { useAsyncResource } from "./async-resource-store";
import { incrementMetric, recordTiming } from "../data/operational-metrics";

type ResolvedImageSource = { uri: string; headers?: Record<string, string> };
type PrivateImageSource = { uri: string | null; headers?: Record<string, string>; source: ResolvedImageSource | null; failed: boolean };
const PrivateImageAccessContext = createContext<GetTransferAccess | null>(null);
const PrivateFileAccessScopeContext = createContext("none");
const PrivateAssetRecoveryContext = createContext<(() => Promise<void>) | null>(null);
const EMPTY_PRIVATE_IMAGE: PrivateImageSource = { uri: null, source: null, failed: false };
const FAILED_PRIVATE_IMAGE: PrivateImageSource = { uri: null, source: null, failed: true };

export function PrivateImageAccessProvider({
  scope,
  getAccess,
  children,
}: {
  scope: string;
  getAccess?: GetTransferAccess;
  children: ReactNode;
}) {
  return createElement(
    PrivateFileAccessScopeContext.Provider,
    { value: scope },
    createElement(PrivateImageAccessContext.Provider, { value: getAccess ?? null }, children),
  );
}

export function PrivateAssetRecoveryProvider({
  recover,
  children,
}: {
  recover?: () => Promise<void>;
  children: ReactNode;
}) {
  return createElement(PrivateAssetRecoveryContext.Provider, { value: recover ?? null }, children);
}

export function usePrivateFileAccessScope(): string {
  return useContext(PrivateFileAccessScopeContext);
}

export function usePrivateImageUri(sourceUri: string | null, sourceHeaders?: Record<string, string>, revision = 0): PrivateImageSource {
  const source = sourceUri === null ? null : imageAssetSource(sourceUri, sourceHeaders);
  return usePrivateAssetUri(source, revision);
}

export function usePrivateAssetUri(source: PrivateAssetSource | null, revision = 0, accessOverride?: GetTransferAccess): PrivateImageSource {
  const inheritedAccess = useContext(PrivateImageAccessContext);
  const recoverMissing = useContext(PrivateAssetRecoveryContext);
  const getAccess = accessOverride ?? inheritedAccess;
  const accessScope = usePrivateFileAccessScope();
  const key = source === null
    ? null
    : `private-asset:${accessScope}:${revision}:${privateAssetCacheKey(source)}`;
  const resource = useAsyncResource<PrivateImageSource>(key, key ?? "none", async (_publish, signal) => {
    if (source === null) return EMPTY_PRIVATE_IMAGE;
    const materialize = materializePrivateAsset(source, getAccess, recoverMissing ?? undefined).then((uri): ResolvedImageSource => ({ uri }));
    const materializeStartedAt = performance.now();
    return await materialize.then((resolved) => {
      if (!signal.aborted) recordTiming("image_materialize_ms", performance.now() - materializeStartedAt);
      return resolved.headers === undefined
        ? { uri: resolved.uri, source: { uri: resolved.uri }, failed: false }
        : { uri: resolved.uri, headers: resolved.headers, source: { uri: resolved.uri, headers: resolved.headers }, failed: false };
    }, async (cause: unknown) => {
      if ((cause as { name?: unknown }).name !== "AbortError") {
        incrementMetric("image_failures");
      }
      return await Promise.reject(cause);
    });
  });
  if (resource.status === "error") {
    return FAILED_PRIVATE_IMAGE;
  }
  return resource.value ?? EMPTY_PRIVATE_IMAGE;
}

function imageAssetSource(uri: string, headers?: Record<string, string>): PrivateAssetSource {
  if (headers !== undefined) return { kind: "direct", uri, headers };
  try {
    const url = new URL(uri);
    if (url.protocol === "http:" || url.protocol === "https:") return { kind: "remote", url: uri };
  } catch {
    // Data and app-private file URIs are handled directly.
  }
  return { kind: "direct", uri };
}
