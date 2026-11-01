import type { CompanionTransport } from "../companionTransportContract";

/** Stable source identity, separate from rotating transport URLs and authorization. */
export interface CachedTransferOptions {
  identity: string;
  scope: string;
}

export interface CachedSourceRequest {
  headers: Record<string, string>;
  options: CachedTransferOptions;
  signal?: AbortSignal | undefined;
  transport: CompanionTransport;
  uri: string;
}

/**
 * A credential-free image addressed by a stable identity instead of its URL, which may be
 * short-lived. Once cached, the identity alone answers and the URL is irrelevant.
 */
export interface DirectImageRequest {
  identity: string;
  /** Owner scope of the cached bytes; purging the scope removes them. */
  scope: string;
  signal: AbortSignal;
  /** `null` when the URL is known to have expired: only a cached copy can answer. */
  uri: string | null;
}

/** How a direct image request ended; a refused URL reports the HTTP status. */
export type DirectImageResult =
  | { readonly status: "missing" }
  | { readonly status: "ready"; readonly uri: string }
  | { readonly httpStatus: number; readonly status: "rejected" };
