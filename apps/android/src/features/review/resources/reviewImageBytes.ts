/** Browser adapter for a review image already materialized by the private asset owner. */
export async function readReviewImageBytes(
  uri: string,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const response = await fetch(uri, { signal });
  if (!response.ok) {
    throw new Error(`Image preview unavailable (${String(response.status)})`);
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
  };
}
