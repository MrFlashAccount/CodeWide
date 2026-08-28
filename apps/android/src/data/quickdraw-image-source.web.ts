import { Image } from "react-native";

import {
  createQuickdrawImageSnapshot,
  imageDataUrl,
  type QuickdrawImageSnapshot,
  type QuickdrawImageSource,
} from "./quickdraw-image";

export async function loadQuickdrawImageSnapshot(source: QuickdrawImageSource): Promise<QuickdrawImageSnapshot> {
  const [{ width, height }, dataUrl] = await Promise.all([
    source.headers === undefined
      ? Image.getSize(source.uri)
      : Image.getSizeWithHeaders(source.uri, source.headers),
    readImageDataUrl(source),
  ]);
  return createQuickdrawImageSnapshot(dataUrl, width, height);
}

async function readImageDataUrl(source: QuickdrawImageSource): Promise<string> {
  if (source.uri.startsWith("data:image/")) return source.uri;
  const response = await fetch(source.uri, source.headers === undefined ? {} : { headers: source.headers });
  if (!response.ok) throw new Error(`Image could not be opened (${response.status})`);
  return imageDataUrl(new Uint8Array(await response.arrayBuffer()), response.headers.get("content-type"), source.uri);
}
