import { File } from "expo-file-system";
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
  const [{ height, width }, bytes] = await Promise.all([
    Image.getSize(source.uri),
    new File(source.uri).bytes(),
  ]);
  return createQuickdrawImageSnapshot(
    imageDataUrl(bytes, source.contentType, source.uri),
    width,
    height,
  );
}
