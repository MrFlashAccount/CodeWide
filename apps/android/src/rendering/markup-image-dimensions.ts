/** Intrinsic image dimensions validated at the HTML boundary, in pixels. */
export interface MarkupImageDimensions { readonly width: number; readonly height: number }

/** Relative CSS sizes do not describe an intrinsic aspect ratio. */
export function markupImageDimensions(attributes: Readonly<Record<string, string>>): MarkupImageDimensions | undefined {
  if (!/^\d+(?:\.\d+)?$/u.test(attributes.width ?? "") || !/^\d+(?:\.\d+)?$/u.test(attributes.height ?? "")) return undefined;
  const width = Number(attributes.width);
  const height = Number(attributes.height);
  return width > 0 && height > 0 && width <= 65535 && height <= 65535 ? { width, height } : undefined;
}
