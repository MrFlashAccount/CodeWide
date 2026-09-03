import type { PreviewTransport } from "../../application/preview/previewTransport";

const unavailable = (): Promise<never> =>
  Promise.reject(new Error("Private previews are available on Android only"));

export function createClosedPreviewTransport(): PreviewTransport {
  return {
    exportFile: unavailable,
    materialize: unavailable,
    read: unavailable,
    save: unavailable,
    stream: unavailable,
  };
}
