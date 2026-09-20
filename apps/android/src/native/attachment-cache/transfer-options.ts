/** Stable source identity, separate from rotating transport URLs and authorization. */
export interface CachedTransferOptions {
  identity: string;
  scope: string;
}

export interface CachedSourceRequest {
  headers: Record<string, string>;
  options: CachedTransferOptions;
  signal?: AbortSignal | undefined;
  uri: string;
}
