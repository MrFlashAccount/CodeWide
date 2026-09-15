import { cacheInlineAttachment } from "../native/attachment-cache/cached-transfer";
import { inlineImagePayload } from "./image-source";

/** Inline bytes join the same disk budget as downloaded attachments. */
export async function materializePrivateImageUri(
  uri: string,
  _headers?: Record<string, string>,
): Promise<string> {
  const payload = inlineImagePayload(uri);
  return payload === null ? uri : cacheInlineAttachment(uri, payload.base64);
}
