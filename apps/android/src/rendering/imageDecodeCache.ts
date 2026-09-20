const DECODED_IMAGE_LIMIT = 512;
const decodedImageUris = new Map<string, true>();

/** Records native decode readiness independently of one React mount. */
export function recordDecodedImage(uri: string): void {
  decodedImageUris.delete(uri);
  decodedImageUris.set(uri, true);
  while (decodedImageUris.size > DECODED_IMAGE_LIMIT) {
    const oldest = decodedImageUris.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    decodedImageUris.delete(oldest);
  }
}

export function wasImageDecoded(uri: string): boolean {
  return decodedImageUris.has(uri);
}
