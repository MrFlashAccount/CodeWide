interface DiagramPreview {
  readonly height: number;
  readonly uri: string;
  readonly width: number;
}

export type DiagramPreviewResult =
  | { readonly preview: DiagramPreview; readonly status: "ready" }
  | { readonly message: string; readonly status: "error" };

export function parseDiagramPreviewResult(serialized: string): DiagramPreviewResult {
  const value: unknown = JSON.parse(serialized);
  if (typeof value !== "object" || value === null || !("type" in value)) {
    throw new Error("Invalid diagram renderer response");
  }
  if (value.type === "error") {
    if (!("message" in value) || typeof value.message !== "string" || value.message.trim() === "") {
      throw new Error("Invalid diagram renderer error");
    }
    return { message: value.message, status: "error" };
  }
  if (
    value.type !== "preview" ||
    !("uri" in value) ||
    typeof value.uri !== "string" ||
    !value.uri.startsWith("file://") ||
    !("width" in value) ||
    typeof value.width !== "number" ||
    !Number.isFinite(value.width) ||
    value.width <= 0 ||
    !("height" in value) ||
    typeof value.height !== "number" ||
    !Number.isFinite(value.height) ||
    value.height <= 0
  ) {
    throw new Error("Invalid diagram renderer response");
  }
  return {
    preview: { height: value.height, uri: value.uri, width: value.width },
    status: "ready",
  };
}
