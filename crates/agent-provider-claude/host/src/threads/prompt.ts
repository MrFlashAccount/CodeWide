/**
 * Builds prompt offers from neutral user content.
 *
 * Text passes through. A `data:` image URL becomes a base64 image block. A
 * local image (a file the companion already prepared on this host) is read
 * from disk, bounded to 20 MiB. Anything that cannot become an image is
 * described in text instead of failing the turn.
 */

import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import type { UserContent } from "../protocol.js";
import type { ImageMediaType, PromptContent } from "../claude/port.js";
import { unreachable } from "../support/unreachable.js";

const BYTES_PER_KIB = 1024;
const MIB = BYTES_PER_KIB * BYTES_PER_KIB;
const MAX_IMAGE_MIB = 20;
const MAX_IMAGE_BYTES = MAX_IMAGE_MIB * MIB;
const MEDIA_TYPES: ReadonlyMap<string, ImageMediaType> = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const INLINE_TYPES: ReadonlySet<unknown> = new Set(MEDIA_TYPES.values());
const isInlineType = (value: string): value is ImageMediaType => INLINE_TYPES.has(value);
const DATA_URL = /^data:(image\/[a-z+.-]+);base64,(.*)$/su;

function localImage(path: string): PromptContent {
  const mediaType = MEDIA_TYPES.get(extname(path).toLowerCase());
  try {
    if (mediaType === undefined || statSync(path).size > MAX_IMAGE_BYTES) {
      throw new Error("unsupported image");
    }
    return {
      source: {
        data: readFileSync(path).toString("base64"),
        media_type: mediaType,
        type: "base64",
      },
      type: "image",
    };
  } catch {
    return { text: `[Attached image could not be read: ${path}]`, type: "text" };
  }
}

function urlImage(url: string): PromptContent {
  const [, mediaType, data] = DATA_URL.exec(url) ?? [];
  if (mediaType === undefined || data === undefined || !isInlineType(mediaType)) {
    return { text: `[Attached image: ${url}]`, type: "text" };
  }
  return { source: { data, media_type: mediaType, type: "base64" }, type: "image" };
}

function promptBlock(content: UserContent): PromptContent {
  switch (content.type) {
    case "text":
      return { text: content.text, type: "text" };
    case "image":
      return urlImage(content.url);
    case "localImage":
      return localImage(content.path);
    default:
      return unreachable(content);
  }
}

export function promptContent(input: readonly UserContent[]): readonly PromptContent[] {
  return input.map(promptBlock);
}

/** Plain text of user content (preview, search, history). */
export function contentText(input: readonly UserContent[]): string {
  return input
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n")
    .trim();
}
