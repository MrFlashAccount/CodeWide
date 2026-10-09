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
import type { PromptContent } from "../claude/port.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Bound on the historical prefix used after a lost session. */
export const HISTORY_PREFIX_MAX_BYTES = 16 * 1024;
export const HISTORY_HEADER = "[Historical conversation from this thread]";

function localImage(path: string): PromptContent {
  const mediaType = MEDIA_TYPES[extname(path).toLowerCase()];
  try {
    if (mediaType === undefined || statSync(path).size > MAX_IMAGE_BYTES) throw new Error("unsupported image");
    return { type: "image", source: { type: "base64", media_type: mediaType, data: readFileSync(path).toString("base64") } };
  } catch {
    return { type: "text", text: `[Attached image could not be read: ${path}]` };
  }
}

function urlImage(url: string): PromptContent {
  const match = /^data:(image\/[a-z+.-]+);base64,(.*)$/s.exec(url);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return { type: "text", text: `[Attached image: ${url}]` };
  }
  return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
}

export function promptContent(input: readonly UserContent[]): PromptContent[] {
  return input.map((content) => {
    switch (content.type) {
      case "text":
        return { type: "text", text: content.text };
      case "image":
        return urlImage(content.url);
      case "localImage":
        return localImage(content.path);
    }
  });
}

/** Plain text of user content (preview, search, history). */
export function contentText(input: readonly UserContent[]): string {
  return input
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n")
    .trim();
}

/**
 * Keeps the most recent `HISTORY_PREFIX_MAX_BYTES` of the transcript lines
 * (whole lines only) under the history header.
 */
export function historyPrefix(lines: readonly string[]): string | null {
  const kept: string[] = [];
  let bytes = Buffer.byteLength(`${HISTORY_HEADER}\n\n`, "utf8");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    const size = Buffer.byteLength(`${line}\n`, "utf8");
    if (bytes + size > HISTORY_PREFIX_MAX_BYTES) break;
    kept.unshift(line);
    bytes += size;
  }
  if (kept.length === 0) return null;
  return `${HISTORY_HEADER}\n${kept.join("\n")}\n\n`;
}
