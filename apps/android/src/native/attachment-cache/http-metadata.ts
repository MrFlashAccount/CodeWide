export interface AttachmentMetadata {
  revision: string;
  totalBytes: number;
  bytes: number;
  start: number;
  ranged: boolean;
  contentType: string;
  sha256: string | null;
}

/** A mutable URL is cacheable only with a server-proven content revision. */
export function attachmentMetadata(
  headers: Headers,
  range: string | null,
): AttachmentMetadata | null {
  const length = headers.get("content-length");
  const totalBytes = length === null ? NaN : Number(length);
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) return null;
  const digest = headers.get("x-content-sha256");
  const sha256 = digest !== null && /^[a-f0-9]{64}$/u.test(digest) ? digest : null;
  const etag = headers.get("etag");
  const revision = sha256 ?? (etag !== null && !etag.startsWith("W/") ? etag : null);
  if (revision === null) return null;
  let start = 0;
  let bytes = totalBytes;
  if (range !== null) {
    const match = /^bytes=(\d+)-(\d+)$/u.exec(range);
    if (match === null) return null;
    start = Number(match[1]);
    const end = Number(match[2]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= totalBytes
    )
      return null;
    bytes = Math.min(end + 1, totalBytes) - start;
  }
  return {
    revision,
    totalBytes,
    bytes,
    start,
    ranged: range !== null,
    contentType: headers.get("content-type") ?? "application/octet-stream",
    sha256,
  };
}

export function cachedResponseHeaders(metadata: AttachmentMetadata): Headers {
  const headers = new Headers({
    "content-type": metadata.contentType,
    "content-length": String(metadata.bytes),
  });
  if (metadata.sha256 !== null) headers.set("x-content-sha256", metadata.sha256);
  if (metadata.ranged)
    headers.set(
      "content-range",
      `bytes ${metadata.start}-${metadata.start + metadata.bytes - 1}/${metadata.totalBytes}`,
    );
  return headers;
}
