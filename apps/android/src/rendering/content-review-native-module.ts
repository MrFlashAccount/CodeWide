export type ContentReviewNativeModule = {
  install(reactTag: number, token: string): void;
  uninstall(reactTag: number, token: string): void;
};

/** Native review actions are optional so JS updates remain compatible with older Android binaries. */
export function contentReviewNativeModule(value: unknown): ContentReviewNativeModule | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<ContentReviewNativeModule>;
  if (typeof candidate.install !== "function" || typeof candidate.uninstall !== "function") return null;
  return candidate as ContentReviewNativeModule;
}
