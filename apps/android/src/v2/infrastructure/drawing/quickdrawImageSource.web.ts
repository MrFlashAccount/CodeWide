import { Image } from "react-native";

import {
  createQuickdrawImageSnapshot,
  imageDataUrl,
} from "../../application/drawing/quickdrawImage";
import type { QuickdrawImageSource } from "../../application/drawing/quickdrawImageSource";
import type { PreviewLocalFile } from "../../application/preview/previewTransport";

export function createQuickdrawImageSource(): QuickdrawImageSource {
  return { load };
}

async function load(source: PreviewLocalFile) {
  const [{ height, width }, response] = await Promise.all([
    Image.getSize(source.uri),
    fetch(source.uri),
  ]);
  if (!response.ok) throw new Error(`Image could not be opened (${response.status})`);
  return createQuickdrawImageSnapshot(
    imageDataUrl(new Uint8Array(await response.arrayBuffer()), source.contentType, source.uri),
    width,
    height,
  );
}
