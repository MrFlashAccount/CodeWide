/** Stable source identity, separate from rotating transport URLs and authorization. */
export interface CachedTransferOptions {
  identity: string;
  scope: string;
}
