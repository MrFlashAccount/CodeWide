/**
 * Builds prompt offers from neutral user content.
 *
 * Text passes through. A `data:` image URL becomes a base64 image block. A
 * local image (a file the companion already prepared on this host) is read
 * from disk, bounded to 20 MiB, and typed by its content signature: companion
 * attachment files carry no extension. Anything that cannot become an image
 * is described in text instead of failing the turn.
 */

import { readFileSync, statSync } from "node:fs";
import type { UserContent } from "../protocol.js";
import type { ImageMediaType, PromptContent } from "../claude/port.js";
import { unreachable } from "../support/unreachable.js";

const BYTES_PER_KIB = 1024;
const MIB = BYTES_PER_KIB * BYTES_PER_KIB;
const MAX_IMAGE_MIB = 20;
const MAX_IMAGE_BYTES = MAX_IMAGE_MIB * MIB;
const WEBP_TAG_OFFSET = 8;

interface SignaturePart {
  readonly bytes: Buffer;
  readonly offset: number;
}

interface ImageSignature {
  readonly mediaType: ImageMediaType;
  readonly parts: readonly SignaturePart[];
}

const leading = (bytes: Buffer): SignaturePart => ({ bytes, offset: 0 });

const SIGNATURES: readonly ImageSignature[] = [
  { mediaType: "image/png", parts: [leading(Buffer.from("89504e470d0a1a0a", "hex"))] },
  { mediaType: "image/jpeg", parts: [leading(Buffer.from("ffd8ff", "hex"))] },
  { mediaType: "image/gif", parts: [leading(Buffer.from("GIF87a", "latin1"))] },
  { mediaType: "image/gif", parts: [leading(Buffer.from("GIF89a", "latin1"))] },
  {
    mediaType: "image/webp",
    parts: [
      leading(Buffer.from("RIFF", "latin1")),
      { bytes: Buffer.from("WEBP", "latin1"), offset: WEBP_TAG_OFFSET },
    ],
  },
];
const INLINE_TYPES: ReadonlySet<unknown> = new Set(SIGNATURES.map(({ mediaType }) => mediaType));
const isInlineType = (value: string): value is ImageMediaType => INLINE_TYPES.has(value);
const DATA_URL = /^data:(image\/[a-z+.-]+);base64,(.*)$/su;

function hasPart(content: Buffer, { bytes, offset }: SignaturePart): boolean {
  const end = offset + bytes.length;
  return content.length >= end && content.subarray(offset, end).equals(bytes);
}

function sniffMediaType(content: Buffer): ImageMediaType | undefined {
  return SIGNATURES.find(({ parts }) => parts.every((part) => hasPart(content, part)))?.mediaType;
}

function localImage(path: string): PromptContent {
  try {
    if (statSync(path).size > MAX_IMAGE_BYTES) {
      throw new Error("image too large");
    }
    const bytes = readFileSync(path);
    const mediaType = sniffMediaType(bytes);
    if (mediaType === undefined) {
      throw new Error("unsupported image");
    }
    return {
      source: { data: bytes.toString("base64"), media_type: mediaType, type: "base64" },
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
