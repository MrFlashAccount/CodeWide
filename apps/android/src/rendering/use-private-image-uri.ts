import { createContext, createElement, type ReactNode, useContext } from "react";

import type {
  GetTransferAccess,
  PrivateAssetImageVariant,
  PrivateAssetSource,
} from "../data/private-transfer";
import { materializePrivateAsset } from "./private-asset";
import { useAsyncResource } from "./async-resource-store";
import { privateImageResourceKey } from "./private-image-resource-key";
import { incrementMetric, recordTiming } from "../data/operational-metrics";

type ResolvedImageSource = { headers?: Record<string, string>; uri: string };
type PrivateImageLoadState = {
  failed: boolean;
  headers: Record<string, string> | undefined;
  source: ResolvedImageSource | null;
  uri: string | null;
};

export type PrivateImageDetailRequest = {
  accessScope: string;
  getAccess: GetTransferAccess;
  resourceKey: string;
  revision: number;
  source: Exclude<PrivateAssetSource, { kind: "direct" }>;
};

export type PrivateImageDetailOptions = {
  readonly accessScope: string;
  readonly getAccess: GetTransferAccess | null;
  readonly revision: number;
};

type PrivateImageSource = {
  detail: PrivateImageDetailRequest | null;
  failed: boolean;
  headers: Record<string, string> | undefined;
  source: ResolvedImageSource | null;
  uri: string | null;
};
type PrivateImageOptions = {
  access?: GetTransferAccess | undefined;
  accessScope?: string | undefined;
  revision?: number | undefined;
  variant?: PrivateAssetImageVariant | undefined;
};
const PrivateImageAccessContext = createContext<GetTransferAccess | null>(null);
const PrivateFileAccessScopeContext = createContext("none");
const PrivateAssetRecoveryContext = createContext<(() => Promise<void>) | null>(null);
const EMPTY_PRIVATE_IMAGE: PrivateImageLoadState = {
  failed: false,
  headers: undefined,
  source: null,
  uri: null,
};
const FAILED_PRIVATE_IMAGE: PrivateImageLoadState = {
  failed: true,
  headers: undefined,
  source: null,
  uri: null,
};

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
  return usePrivateAssetUri(source, { revision });
}

export function usePrivateAssetUri(
  source: PrivateAssetSource | null,
  options: PrivateImageOptions = {},
): PrivateImageSource {
  const {
    access: accessOverride,
    accessScope: accessScopeOverride,
    revision = 0,
    variant = "preview",
  } = options;
  const inheritedAccess = useContext(PrivateImageAccessContext);
  const recoverMissing = useContext(PrivateAssetRecoveryContext);
  const getAccess = accessOverride ?? inheritedAccess;
  const inheritedAccessScope = usePrivateFileAccessScope();
  const accessScope = accessScopeOverride ?? inheritedAccessScope;
  const identity = privateImageIdentity({ accessScope, revision, source, variant });
  const resource = useAsyncResource<PrivateImageLoadState>(
    identity.key,
    identity.key ?? "none",
    async (_publish, signal) =>
      loadPrivateImage({
        getAccess,
        recoverMissing: recoverMissing ?? undefined,
        signal,
        source,
        variant,
      }),
  );
  const state = currentPrivateImageState(resource.status, resource.value);
  const detail =
    variant === "preview"
      ? createPrivateImageDetailRequest(source, { accessScope, getAccess, revision })
      : null;
  return {
    detail,
    failed: state.failed,
    headers: state.headers,
    source: state.source,
    uri: state.uri,
  };
}

function currentPrivateImageState(
  status: string,
  value: PrivateImageLoadState | null,
): PrivateImageLoadState {
  if (status === "error") {
    return FAILED_PRIVATE_IMAGE;
  }
  return value ?? EMPTY_PRIVATE_IMAGE;
}

function privateImageIdentity({
  accessScope,
  revision,
  source,
  variant,
}: {
  accessScope: string;
  revision: number;
  source: PrivateAssetSource | null;
  variant: PrivateAssetImageVariant;
}): { key: string | null } {
  if (source === null) {
    return { key: null };
  }
  const sourceKey = privateImageResourceKey(source);
  return {
    key: `private-asset:${accessScope}:${String(revision)}:${variant}:${sourceKey}`,
  };
}

/** Describes a lazy detail fetch without materializing another thumbnail first. */
export function createPrivateImageDetailRequest(
  source: PrivateAssetSource | null,
  options: PrivateImageDetailOptions,
): PrivateImageDetailRequest | null {
  if (source === null || source.kind === "direct" || options.getAccess === null) {
    return null;
  }
  const sourceKey = privateImageResourceKey(source);
  return {
    accessScope: options.accessScope,
    getAccess: options.getAccess,
    resourceKey: `${options.accessScope}:${String(options.revision)}:${sourceKey}`,
    revision: options.revision,
    source,
  };
}

async function loadPrivateImage({
  getAccess,
  recoverMissing,
  signal,
  source,
  variant,
}: {
  getAccess: GetTransferAccess | null;
  recoverMissing?: (() => Promise<void>) | undefined;
  signal: AbortSignal;
  source: PrivateAssetSource | null;
  variant: PrivateAssetImageVariant;
}): Promise<PrivateImageLoadState> {
  if (source === null) {
    return EMPTY_PRIVATE_IMAGE;
  }
  const startedAt = performance.now();
  try {
    const resolved = await materializePrivateAsset(source, {
      getAccess,
      recoverMissing,
      signal,
      variant,
    });
    if (!signal.aborted) {
      recordTiming("image_materialize_ms", performance.now() - startedAt);
    }
    return {
      failed: false,
      headers: resolved.headers,
      source: { headers: resolved.headers, uri: resolved.uri },
      uri: resolved.uri,
    };
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      incrementMetric("image_failures");
    }
    throw error instanceof Error ? error : new Error("Private image request failed");
  }
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
