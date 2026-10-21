/**
 * Plugin-supplied provider glyphs are untrusted. Only one monochrome SVG path in
 * the fixed `0 0 24 24` box is accepted; it is rendered as a single themed
 * `Path`, never as markup. Anything else falls back to the generic icon.
 */
import { unknownRecord } from "./unknownRecord";

/** Maximum UTF-16 length of an accepted path, matching the Companion's 4 KiB cap for ASCII paths. */
const MAX_GLYPH_PATH_LENGTH = 4096;
const GLYPH_VIEW_BOX = "0 0 24 24";
const PATH_ALPHABET = /^[MmLlHhVvCcSsQqTtAaZz0-9 ,.-]+$/u;
const STARTS_WITH_MOVE = /^\s*[Mm]/u;

/** A glyph that passed {@link sanitizeForgeGlyph}. */
export type ForgeGlyph = { readonly path: string; readonly viewBox: typeof GLYPH_VIEW_BOX };

/** Returns the glyph only when it is one bounded path of SVG path commands and numbers. */
export function sanitizeForgeGlyph(value: unknown): ForgeGlyph | null {
  const glyph = unknownRecord(value);
  if (glyph === null || glyph.viewBox !== GLYPH_VIEW_BOX || typeof glyph.path !== "string") {
    return null;
  }
  return isSafePath(glyph.path) ? { path: glyph.path, viewBox: GLYPH_VIEW_BOX } : null;
}

function isSafePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= MAX_GLYPH_PATH_LENGTH &&
    PATH_ALPHABET.test(path) &&
    STARTS_WITH_MOVE.test(path)
  );
}
