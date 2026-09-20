import { occurrenceKey, textFingerprint } from "../../../rendering/listKey";
import { isProtocolRecord, recordValue } from "./protocolValue";

export function nextFileChangeItemKey(occurrences: Map<string, number>, path: string): string {
  return occurrenceKey(occurrences, path);
}

/** Preserves one result slot while its streamed payload changes. */
export function toolRichItemIdentity(value: unknown, index: number): string {
  if (!isProtocolRecord(value)) {
    return `${typeof value}:index:${String(index)}`;
  }
  const type = typeof value.type === "string" ? value.type : "record";
  for (const field of ["id", "uri", "url", "imageUrl", "image_url", "name"] as const) {
    const fieldValue = value[field];
    if (typeof fieldValue === "string") {
      return `${type}:${field}:${textFingerprint(fieldValue)}`;
    }
  }
  const asset = recordValue(value.codewideAsset);
  return typeof asset.id === "string"
    ? `${type}:asset:${asset.id}`
    : `${type}:index:${String(index)}`;
}
