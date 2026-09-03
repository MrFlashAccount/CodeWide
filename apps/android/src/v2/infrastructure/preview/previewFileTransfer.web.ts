import type {
  PreviewFileRequest,
  PreviewLocalFile,
  PreviewStreamSource,
} from "../../application/preview/previewTransport";

interface PreviewFileTransferInput {
  request: PreviewFileRequest;
  source: PreviewStreamSource;
}

const unavailable = (): Promise<never> =>
  Promise.reject(new Error("Private attachment export is available on Android only"));

export function materializePreviewFile(
  _input: PreviewFileTransferInput,
): Promise<PreviewLocalFile> {
  return unavailable();
}

export function savePreviewFile(_input: PreviewFileTransferInput): Promise<PreviewLocalFile> {
  return unavailable();
}

export function exportPreviewFile(_input: PreviewFileTransferInput): Promise<PreviewLocalFile> {
  return unavailable();
}
