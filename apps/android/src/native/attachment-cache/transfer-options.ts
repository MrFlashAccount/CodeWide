/** Stable source identity, separate from rotating transport URLs and authorization. */
export interface CachedTransferOptions {
  scope: string;
  identity: string;
}
