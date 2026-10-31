const HALF = 0.5;

export type PeleDiagramViewBoxInput = {
  readonly fitHeight: number;
  readonly fitWidth: number;
  readonly scale: number;
  readonly sourceHeight: number;
  readonly sourceWidth: number;
  readonly translateX: number;
  readonly translateY: number;
};

export type PeleDiagramTextureTransformInput = {
  readonly committedScale: number;
  readonly committedTranslateX: number;
  readonly committedTranslateY: number;
  readonly scale: number;
  readonly translateX: number;
  readonly translateY: number;
};

export type PeleDiagramTextureTransform = {
  readonly scale: number;
  readonly translateX: number;
  readonly translateY: number;
};

/** Maps screen-space pan/zoom into source-space SVG coordinates. */
export function peleDiagramViewBox(input: PeleDiagramViewBoxInput): string {
  "worklet";
  if (
    input.fitHeight <= 0 ||
    input.fitWidth <= 0 ||
    input.scale <= 0 ||
    input.sourceHeight <= 0 ||
    input.sourceWidth <= 0
  ) {
    return `0 0 ${String(input.sourceWidth)} ${String(input.sourceHeight)}`;
  }
  const height = input.sourceHeight / input.scale;
  const width = input.sourceWidth / input.scale;
  const x =
    (input.sourceWidth - width) * HALF -
    (input.translateX * input.sourceWidth) / (input.fitWidth * input.scale);
  const y =
    (input.sourceHeight - height) * HALF -
    (input.translateY * input.sourceHeight) / (input.fitHeight * input.scale);
  return `${String(x)} ${String(y)} ${String(width)} ${String(height)}`;
}

/** Maps two absolute SVG viewport states into one transient texture transform. */
export function peleDiagramTextureTransform(
  input: PeleDiagramTextureTransformInput,
): PeleDiagramTextureTransform {
  "worklet";
  if (input.committedScale <= 0 || input.scale <= 0) {
    return { scale: 1, translateX: 0, translateY: 0 };
  }
  const scale = input.scale / input.committedScale;
  return {
    scale,
    translateX: input.translateX - input.committedTranslateX * scale,
    translateY: input.translateY - input.committedTranslateY * scale,
  };
}
