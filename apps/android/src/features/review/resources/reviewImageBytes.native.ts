import { File } from "expo-file-system";

/** Native file-system adapter for the authenticated review image cache. */
export async function readReviewImageBytes(
  uri: string,
  _signal: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  return { bytes: await new File(uri).bytes(), contentType: null };
}
