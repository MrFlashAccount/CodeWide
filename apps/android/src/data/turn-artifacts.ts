import { privateImageAssetProjection } from "../rendering/image-source";

type ArtifactReference =
  | { readonly savedPath: string }
  | {
      readonly codewideAsset: {
        readonly version: 1;
        readonly id: string;
        readonly byteLength: number;
        readonly contentType: string;
      };
    }
  | { readonly uri: string };

/** Preserve displayable outputs before discarding lazy activity; never retain tool bodies or image bytes. */
export function compactTurnArtifactReferences(turn: unknown): readonly ArtifactReference[] {
  const references: ArtifactReference[] = [];
  const seen = new Set<string>();
  const append = (value: unknown): void => {
    const reference = artifactReference(value);
    if (reference === null) return;
    const key =
      "savedPath" in reference
        ? `path:${reference.savedPath}`
        : "uri" in reference
          ? `uri:${reference.uri}`
          : `content:${reference.codewideAsset.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push(reference);
  };
  if (!isRecord(turn)) return references;
  if (isRecord(turn.codewide) && Array.isArray(turn.codewide.artifacts)) {
    for (const reference of turn.codewide.artifacts) append(reference);
  }
  if (!Array.isArray(turn.items)) return references;
  for (const item of turn.items) {
    if (!isRecord(item)) continue;
    if (item.type === "imageGeneration") append(item);
    if (item.type !== "dynamicToolCall" && item.type !== "mcpToolCall") continue;
    for (const content of [
      item.content,
      item.contentItems,
      item.output,
      isRecord(item.result) ? item.result.content : null,
    ]) {
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!isRecord(part)) continue;
        if (part.codewideAsset !== undefined) append({ codewideAsset: part.codewideAsset });
        if (part.type === "resource_link") append({ uri: part.uri });
      }
    }
  }
  return references;
}

function artifactReference(value: unknown): ArtifactReference | null {
  if (!isRecord(value)) return null;
  if (absolutePath(value.savedPath)) return { savedPath: value.savedPath };
  const asset = privateImageAssetProjection(value.codewideAsset);
  if (asset !== null) return { codewideAsset: { version: 1, ...asset } };
  if (absolutePath(value.uri)) return { uri: value.uri };
  if (
    typeof value.uri === "string" &&
    value.uri.startsWith("sandbox:") &&
    absolutePath(value.uri.slice(8))
  ) {
    return { uri: value.uri.slice(8) };
  }
  return null;
}

function absolutePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    value.length <= 4096 &&
    !value.includes("\0")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
