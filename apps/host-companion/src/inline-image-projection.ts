import path from "node:path";

import type { PrivateAssetReference, PrivateContentService } from "./private-content.js";

type RpcObject = Record<string, unknown>;

const INLINE_IMAGE_PATTERN = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,/iu;
const INLINE_IMAGE_CAPTURE = /^data:(image\/(?:avif|gif|jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/iu;
const MENTIONED_IMAGE_PATTERN = /^##[^\r\n]*?:\s+(\/[^\r\n]+\.(?:avif|gif|jpe?g|png|webp))\s*$/gimu;
const MAX_INLINE_ASSET_BYTES = 32 * 1024 * 1024;

export type CodeWideAssetProjection = PrivateAssetReference & { version: 1 };

/**
 * App Server can embed multi-megabyte image data URLs inside a userMessage.
 * History summaries and live notifications are UI metadata lanes, not binary
 * transfer lanes. Prefer the exact local attachment path already included in
 * the trusted Files-mentioned preamble; otherwise retain only a compact
 * unavailable marker instead of forwarding the blob into Hermes and SQLite.
 */
export function compactInlineImagesInItem(value: RpcObject, content?: PrivateContentService): RpcObject {
  let projected = compactUserMessageImages(value, content);
  projected = compactToolResultImages(projected, content);
  projected = compactImageGenerationResult(projected, content);
  return projected;
}

function compactImageGenerationResult(value: RpcObject, content?: PrivateContentService): RpcObject {
  if (content === undefined || value.type !== "imageGeneration" || typeof value.result !== "string") return value;
  const asset = storeGeneratedImage(value.result, content);
  if (asset === null) return value;
  return { ...value, result: "", codewideAsset: asset };
}

function compactUserMessageImages(value: RpcObject, assetStore?: PrivateContentService): RpcObject {
  if (value.type !== "userMessage" || !Array.isArray(value.content)) return value;
  const imagePaths = mentionedImagePaths(value.content);
  let imageIndex = 0;
  let changed = false;
  const projectedContent = value.content.map((rawPart) => {
    const part = asObject(rawPart);
    if (part?.type !== "image" || typeof part.url !== "string" || !INLINE_IMAGE_PATTERN.test(part.url)) return rawPart;
    const localPath = imagePaths[imageIndex++];
    changed = true;
    if (localPath !== undefined) {
      const { url: _url, ...rest } = part;
      return { ...rest, type: "localImage", path: localPath };
    }
    const asset = assetStore === undefined ? null : storeDataImage(part.url, assetStore);
    if (asset !== null) {
      const { url: _url, ...rest } = part;
      return { ...rest, url: "", codewideAsset: asset };
    }
    return {
      type: "image",
      ...(part.detail === undefined ? {} : { detail: part.detail }),
      url: "",
      codewideUnavailable: "inline_image_without_file_reference",
    };
  });
  return changed ? { ...value, content: projectedContent } : value;
}

function compactToolResultImages(value: RpcObject, content?: PrivateContentService): RpcObject {
  if (content === undefined) return value;
  const compactItems = (rawItems: unknown[]): { items: unknown[]; changed: boolean } => {
    let changed = false;
    const items = rawItems.map((rawItem) => {
      const item = asObject(rawItem);
      if (item === null) return rawItem;
      const type = item.type;
      const urlKey = type === "inputImage" ? "imageUrl" : type === "input_image" ? "image_url" : null;
      if (urlKey !== null && typeof item[urlKey] === "string" && INLINE_IMAGE_PATTERN.test(item[urlKey])) {
        const asset = storeDataImage(item[urlKey], content);
        if (asset === null) return rawItem;
        changed = true;
        return { ...item, [urlKey]: "", codewideAsset: asset };
      }
      if (type === "image" && typeof item.data === "string") {
        const mimeType = typeof item.mimeType === "string" ? item.mimeType : "image/png";
        const asset = storeBase64Image(item.data, mimeType, content);
        if (asset === null) return rawItem;
        changed = true;
        const { data: _data, ...rest } = item;
        return { ...rest, codewideAsset: asset };
      }
      return rawItem;
    });
    return { items, changed };
  };
  let next = value;
  if (Array.isArray(value.contentItems)) {
    const projection = compactItems(value.contentItems);
    if (projection.changed) next = { ...next, contentItems: projection.items };
  }
  const result = asObject(value.result);
  if (result !== null && Array.isArray(result.content)) {
    const projection = compactItems(result.content);
    if (projection.changed) next = { ...next, result: { ...result, content: projection.items } };
  }
  return next;
}

export function compactInlineImagesInTurn(value: RpcObject, content?: PrivateContentService): RpcObject {
  if (!Array.isArray(value.items)) return value;
  let changed = false;
  const items = value.items.map((rawItem) => {
    const item = asObject(rawItem);
    if (item === null) return rawItem;
    const compacted = compactInlineImagesInItem(item, content);
    if (compacted !== item) changed = true;
    return compacted;
  });
  return changed ? { ...value, items } : value;
}

export function compactInlineImagesInNotification(method: string, payload: unknown, content?: PrivateContentService): unknown {
  const params = asObject(payload);
  if (params === null) return payload;
  if (method === "turn/started" || method === "turn/completed") {
    const turn = asObject(params.turn);
    if (turn === null) return payload;
    const compacted = compactInlineImagesInTurn(turn, content);
    return compacted === turn ? payload : { ...params, turn: compacted };
  }
  if (method === "item/started" || method === "item/completed") {
    const item = asObject(params.item);
    if (item === null) return payload;
    const compacted = compactInlineImagesInItem(item, content);
    return compacted === item ? payload : { ...params, item: compacted };
  }
  if (method === "thread/started") {
    const thread = asObject(params.thread);
    if (thread === null || !Array.isArray(thread.turns)) return payload;
    let changed = false;
    const turns = thread.turns.map((rawTurn) => {
      const turn = asObject(rawTurn);
      if (turn === null) return rawTurn;
      const compacted = compactInlineImagesInTurn(turn, content);
      if (compacted !== turn) changed = true;
      return compacted;
    });
    return changed ? { ...params, thread: { ...thread, turns } } : payload;
  }
  return payload;
}

function storeDataImage(value: string, content: PrivateContentService): CodeWideAssetProjection | null {
  const match = INLINE_IMAGE_CAPTURE.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined) return null;
  return storeBase64Image(match[2], match[1].toLowerCase(), content);
}

function storeBase64Image(value: string, contentType: string, content: PrivateContentService): CodeWideAssetProjection | null {
  if (!/^image\/(?:avif|gif|jpeg|png|webp)$/u.test(contentType)) return null;
  const normalized = value.replaceAll(/\s/gu, "");
  if (normalized.length === 0 || normalized.length > Math.ceil(MAX_INLINE_ASSET_BYTES * 4 / 3) + 4) return null;
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0 || bytes.length > MAX_INLINE_ASSET_BYTES) return null;
  return { version: 1, ...content.putBytes(bytes, contentType) };
}

function storeGeneratedImage(value: string, content: PrivateContentService): CodeWideAssetProjection | null {
  const dataImage = storeDataImage(value, content);
  if (dataImage !== null) return dataImage;
  const normalized = value.replaceAll(/\s/gu, "");
  if (normalized.length === 0 || normalized.length > Math.ceil(MAX_INLINE_ASSET_BYTES * 4 / 3) + 4) return null;
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0 || bytes.length > MAX_INLINE_ASSET_BYTES) return null;
  const contentType = imageContentType(bytes);
  return contentType === null ? null : { version: 1, ...content.putBytes(bytes, contentType) };
}

function imageContentType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp" && ["avif", "avis"].includes(bytes.subarray(8, 12).toString("ascii"))) return "image/avif";
  return null;
}

function mentionedImagePaths(content: unknown[]): string[] {
  const result: string[] = [];
  for (const rawPart of content) {
    const part = asObject(rawPart);
    if (part?.type !== "text" || typeof part.text !== "string") continue;
    MENTIONED_IMAGE_PATTERN.lastIndex = 0;
    for (const match of part.text.matchAll(MENTIONED_IMAGE_PATTERN)) {
      const candidate = match[1];
      if (
        candidate !== undefined
        && candidate.length <= 16_384
        && !candidate.includes("\0")
        && path.isAbsolute(candidate)
      ) result.push(candidate);
    }
  }
  return result;
}

function asObject(value: unknown): RpcObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RpcObject
    : null;
}
