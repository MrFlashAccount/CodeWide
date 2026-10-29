/**
 * Forge provider icons are supplied by each forge plugin and resolved by the
 * Companion; Android never maps a provider name to a mark. The value is
 * untrusted: anything outside the bounded `glyph` and `image` shapes decodes to
 * `null`, which renders the neutral icon, and never fails the enclosing read.
 */
import { unknownRecord } from "./unknownRecord";

/** Image formats a provider may ship; SVG is parsed by `react-native-svg`, rasters by `Image`. */
type ProviderIconMimeType = "image/png" | "image/svg+xml" | "image/webp";

/**
 * A provider mark: a monochrome SVG path tinted with the theme color, or a
 * full-colour image rendered as-is.
 */
export type ProviderIcon =
  | { readonly kind: "glyph"; readonly path: string; readonly viewBox: string }
  | {
      readonly dataBase64: string;
      readonly kind: "image";
      readonly mimeType: ProviderIconMimeType;
    };

/** Path data cap in bytes; the accepted alphabet is ASCII, so UTF-16 length equals bytes. */
const MAX_GLYPH_PATH_LENGTH = 4096;
const MAX_VIEW_BOX_SIDE = 1024;
/** Decoded image cap: 64 KiB. */
const MAX_IMAGE_BYTES = 65_536;
/** Standard base64 encodes every 3 bytes as 4 characters, padding the last group with `=`. */
const BASE64_GROUP_BYTES = 3;
const BASE64_GROUP_CHARS = 4;
/** Longest padded standard base64 text of {@link MAX_IMAGE_BYTES} bytes. */
const MAX_IMAGE_BASE64_LENGTH =
  Math.ceil(MAX_IMAGE_BYTES / BASE64_GROUP_BYTES) * BASE64_GROUP_CHARS;
const VIEW_BOX = /^0 0 ([1-9][0-9]{0,3}) ([1-9][0-9]{0,3})$/u;
const PATH_ALPHABET = /^[MmLlHhVvCcSsQqTtAaZz0-9 ,.-]+$/u;
const STARTS_WITH_MOVE = /^ *[Mm]/u;
const BASE64_ALPHABET = /^[A-Za-z0-9+/]+={0,2}$/u;
const BASE64_PADDING = /=*$/u;
const MIME_TYPES: readonly ProviderIconMimeType[] = ["image/png", "image/svg+xml", "image/webp"];

/** Decodes one wire icon; every unsupported or malformed value is `null`. */
export function providerIcon(value: unknown): ProviderIcon | null {
  const icon = unknownRecord(value);
  if (icon === null) {
    return null;
  }
  if (icon.kind === "glyph") {
    return glyphIcon(icon.viewBox, icon.path);
  }
  return icon.kind === "image" ? imageIcon(icon.mimeType, icon.dataBase64) : null;
}

function glyphIcon(viewBox: unknown, path: unknown): ProviderIcon | null {
  if (typeof viewBox !== "string" || typeof path !== "string") {
    return null;
  }
  return isViewBox(viewBox) && isPathData(path) ? { kind: "glyph", path, viewBox } : null;
}

function imageIcon(mimeType: unknown, dataBase64: unknown): ProviderIcon | null {
  const mime = MIME_TYPES.find((candidate) => candidate === mimeType);
  if (mime === undefined || typeof dataBase64 !== "string" || !isBoundedBase64(dataBase64)) {
    return null;
  }
  return { dataBase64, kind: "image", mimeType: mime };
}

function isViewBox(viewBox: string): boolean {
  const [, width, height] = VIEW_BOX.exec(viewBox) ?? [];
  return Number(width) <= MAX_VIEW_BOX_SIDE && Number(height) <= MAX_VIEW_BOX_SIDE;
}

function isPathData(path: string): boolean {
  return (
    path.length <= MAX_GLYPH_PATH_LENGTH && PATH_ALPHABET.test(path) && STARTS_WITH_MOVE.test(path)
  );
}

/** Standard padded base64 whose decoded size is within {@link MAX_IMAGE_BYTES}. */
function isBoundedBase64(data: string): boolean {
  if (
    data.length > MAX_IMAGE_BASE64_LENGTH ||
    data.length % BASE64_GROUP_CHARS !== 0 ||
    !BASE64_ALPHABET.test(data)
  ) {
    return false;
  }
  const padding = BASE64_PADDING.exec(data)?.[0].length ?? 0;
  return (data.length / BASE64_GROUP_CHARS) * BASE64_GROUP_BYTES - padding <= MAX_IMAGE_BYTES;
}
