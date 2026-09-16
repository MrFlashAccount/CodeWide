export type ContentReviewNativeModule = {
  install: (reactTag: number, token: string) => void;
  setHighlights?: (
    reactTag: number,
    token: string,
    highlights: readonly { end: number; start: number }[],
  ) => void;
  uninstall: (reactTag: number, token: string) => void;
};

/** Native review actions are optional so JS updates remain compatible with older Android binaries. */
export function contentReviewNativeModule(value: unknown): ContentReviewNativeModule | null {
  const candidate = unknownRecord(value);
  if (candidate === null) {
    return null;
  }
  if (typeof candidate.install !== "function" || typeof candidate.uninstall !== "function") {
    return null;
  }
  // WHY: React Native exposes callable native methods without parameter metadata after registration; presence is the only runtime capability check available.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return candidate as ContentReviewNativeModule;
}
import { unknownRecord } from "../data/unknownRecord";
