import type { PrivateAssetSource } from "../data/private-transfer";

import { imageReferenceIdentity, scopedImageReferenceKey } from "./imageReferenceIdentity";

const CONTENT_ID_LENGTH = 64;

/** A bounded in-memory key. Companion content is already addressed by the digest of its bytes. */
export function privateImageResourceKey(source: PrivateAssetSource): string {
  if (source.kind === "content") {
    return source.id.length === CONTENT_ID_LENGTH && /^[a-f0-9]{64}$/u.test(source.id)
      ? `content:${source.id}`
      : `invalid-content:${imageReferenceIdentity(source, source.id)}`;
  }
  if (source.kind === "direct") {
    return `direct:${imageReferenceIdentity(source, source.uri)}:${imageHeaderIdentity(source.headers)}`;
  }
  if (source.kind === "remote") {
    return `remote:${imageReferenceIdentity(source, source.url)}`;
  }
  if (source.kind === "path") {
    return `path:${imageReferenceIdentity(source, source.path)}`;
  }
  return scopedImageReferenceKey(source);
}

function imageHeaderIdentity(headers: Record<string, string> | undefined): string {
  if (headers === undefined) {
    return "";
  }
  const names = Object.keys(headers).sort();
  return names.length === 0
    ? ""
    : imageReferenceIdentity(headers, JSON.stringify(names.map((name) => [name, headers[name]])));
}
