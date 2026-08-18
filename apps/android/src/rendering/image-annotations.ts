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

export function formatImageAnnotations(images: AnnotatedImage[]): string {
  const populated = images.filter((image) => image.annotations.length > 0);
  if (populated.length === 0) return "";
  const lines = [
    "## Image annotations",
    "Coordinates are percentages of the original image, measured from the top-left corner.",
    "",
  ];
  populated.forEach((image, imageIndex) => {
    const identity = image.reference === null || image.reference === image.label
      ? image.label
      : `${image.label} (${image.reference})`;
    lines.push(`### Image ${imageIndex + 1}: ${identity}`);
    image.annotations.forEach((annotation, annotationIndex) => {
      const x = (clampNormalizedCoordinate(annotation.x) * 100).toFixed(1);
      const y = (clampNormalizedCoordinate(annotation.y) * 100).toFixed(1);
      lines.push(`${annotationIndex + 1}. **(${x}%, ${y}%)** — ${annotation.text.trim()}`);
    });
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}
