import { fromByteArray } from "base64-js";

export interface QuickdrawImageSnapshot extends Record<string, unknown> {
  document: {
    store: Record<string, Record<string, unknown>>;
  };
}

const BACKGROUND_ASSET_ID = "asset:codewide-background";
const BACKGROUND_SHAPE_ID = "shape:codewide-background";

export function createQuickdrawImageSnapshot(
  dataUrl: string,
  width: number,
  height: number,
): QuickdrawImageSnapshot {
  if (!dataUrl.startsWith("data:image/")) {
    throw new Error("Image annotation requires an embedded image");
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Image annotation requires valid image dimensions");
  }
  return {
    document: {
      store: {
        [BACKGROUND_ASSET_ID]: {
          h: height,
          id: BACKGROUND_ASSET_ID,
          src: dataUrl,
          typeName: "asset",
          w: width,
        },
        [BACKGROUND_SHAPE_ID]: {
          id: BACKGROUND_SHAPE_ID,
          props: {
            assetId: BACKGROUND_ASSET_ID,
            h: height,
            locked: true,
            w: width,
          },
          rot: 0,
          type: "image",
          typeName: "shape",
          x: 0,
          y: 0,
          z: -1,
        },
      },
    },
  };
}

export function imageDataUrl(bytes: Uint8Array, contentType: string, uri: string): string {
  return `data:${detectImageMediaType(bytes, contentType, uri)};base64,${fromByteArray(bytes)}`;
}

export function annotatedImageName(label: string, now: Date): string {
  const normalized = label
    .replaceAll(/\.[a-zA-Z0-9]{1,10}$/gu, "")
    .replaceAll(/[^a-zA-Z0-9._-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 80);
  const stem = normalized === "" ? "image" : normalized;
  return `annotated-${stem}-${now.toISOString().replaceAll(/[:.]/gu, "-")}.png`;
}

export function parseQuickdrawImageSnapshot(value: string): QuickdrawImageSnapshot {
  const parsed: unknown = JSON.parse(value);
  if (!isQuickdrawImageSnapshot(parsed)) throw new Error("Drawing snapshot is invalid");
  return parsed;
}

function detectImageMediaType(bytes: Uint8Array, contentType: string, uri: string): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) {
    return "image/gif";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 4, 4) === "ftyp" &&
    ["avif", "avis"].includes(ascii(bytes, 8, 4))
  ) {
    return "image/avif";
  }
  const normalizedContentType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (
    ["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"].includes(
      normalizedContentType,
    )
  ) {
    return normalizedContentType;
  }
  const extension = /\.([a-zA-Z0-9]+)(?:[?#]|$)/u.exec(uri)?.[1]?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "avif") return "image/avif";
  throw new Error("Image annotation requires a supported image format");
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCodePoint(...bytes.slice(offset, offset + length));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isQuickdrawImageSnapshot(value: unknown): value is QuickdrawImageSnapshot {
  if (!isRecord(value)) return false;
  const document = value.document;
  if (!isRecord(document) || !isRecord(document.store)) return false;
  return Object.values(document.store).every(isRecord);
}
