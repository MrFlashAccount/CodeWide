export type ImagePointAnnotation = {
  id: string;
  x: number;
  y: number;
  text: string;
};

export type AnnotatedImage = {
  label: string;
  reference: string | null;
  annotations: ImagePointAnnotation[];
};

export function clampNormalizedCoordinate(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function serializeImageReviewAttachment(images: readonly AnnotatedImage[]): string {
  const populated = images.filter((image) => image.annotations.length > 0);
  if (populated.length === 0) return "";
  const commentCount = populated.reduce((count, image) => count + image.annotations.length, 0);
  const lines = [
    "---",
    "kind: codewide-image-review",
    "version: 1",
    `images: ${populated.length}`,
    `comments: ${commentCount}`,
    "---",
    "",
    "# Image review comments",
    "",
    "Coordinates are percentages of the original image, measured from the top-left corner.",
    "",
  ];
  populated.forEach((image, imageIndex) => {
    lines.push(`## Image ${imageIndex + 1}: \`${escapeInlineCode(image.label.trim() || "Image")}\``, "");
    if (image.reference !== null && image.reference !== image.label) {
      lines.push(`Reference: \`${escapeInlineCode(image.reference)}\``, "");
    }
    image.annotations.forEach((annotation, annotationIndex) => {
      const x = (clampNormalizedCoordinate(annotation.x) * 100).toFixed(1);
      const y = (clampNormalizedCoordinate(annotation.y) * 100).toFixed(1);
      lines.push(`${annotationIndex + 1}. **(${x}%, ${y}%)** — ${annotation.text.trim()}`);
    });
    lines.push("");
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

function escapeInlineCode(value: string): string {
  return value.replaceAll("`", "\\`").replaceAll("\n", " ");
}
