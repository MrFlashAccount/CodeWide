const PRIVATE_IMAGE_PREFIX = "codewide-private-image:";

/** Keeps authenticated image sources opaque to Markdown's public-URL fallback. */
export function privateImageReference(sourceUrl: string): string {
  return `${PRIVATE_IMAGE_PREFIX}${encodeURIComponent(sourceUrl)}`;
}

export function privateImageSourceUrl(reference: string): string | null {
  if (!reference.startsWith(PRIVATE_IMAGE_PREFIX)) return null;
  try {
    const sourceUrl = decodeURIComponent(reference.slice(PRIVATE_IMAGE_PREFIX.length));
    return sourceUrl === "" ? null : sourceUrl;
  } catch {
    return null;
  }
}
