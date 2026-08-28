import { fromByteArray } from "base64-js";

export type QuickdrawImageSource = {
  uri: string;
  headers?: Record<string, string>;
};

export type QuickdrawImageSnapshot = {
  document: {
    store: Record<string, Record<string, unknown>>;
  };
};

const BACKGROUND_ASSET_ID = "asset:codewide-background";
const BACKGROUND_SHAPE_ID = "shape:codewide-background";

export function createQuickdrawImageSnapshot(
  dataUrl: string,
  width: number,
  height: number,
): QuickdrawImageSnapshot {
  if (!dataUrl.startsWith("data:image/")) throw new Error("Image annotation requires an embedded image");
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Image annotation requires valid image dimensions");
  }
  return {
    document: {
      store: {
        [BACKGROUND_ASSET_ID]: {
          id: BACKGROUND_ASSET_ID,
          typeName: "asset",
          src: dataUrl,
          w: width,
          h: height,
        },
        [BACKGROUND_SHAPE_ID]: {
          id: BACKGROUND_SHAPE_ID,
          typeName: "shape",
          type: "image",
          x: 0,
          y: 0,
          rot: 0,
          z: -1,
          props: {
            assetId: BACKGROUND_ASSET_ID,
            locked: true,
            w: width,
            h: height,
          },
        },
      },
    },
  };
}

export function imageDataUrl(bytes: Uint8Array, contentType: string | null, uri: string): string {
  return `data:${detectImageMimeType(bytes, contentType, uri)};base64,${fromByteArray(bytes)}`;
}

export function annotatedImageName(label: string, now = new Date()): string {
  const stem = label
    .replace(/\.[a-zA-Z0-9]{1,10}$/u, "")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80) || "image";
  return `annotated-${stem}-${now.toISOString().replace(/[:.]/gu, "-")}.png`;
}

function detectImageMimeType(bytes: Uint8Array, contentType: string | null, uri: string): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 4))) return "image/avif";

  const normalizedContentType = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"].includes(normalizedContentType)) {
    return normalizedContentType;
  }
  const extension = /\.([a-zA-Z0-9]+)(?:[?#]|$)/u.exec(uri)?.[1]?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "avif") return "image/avif";
  return "image/jpeg";
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}
