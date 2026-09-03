interface TimelineActivityResource {
  kind: "audio" | "image" | "link" | "text";
  label: string;
  value: string;
}

export interface TimelineActivityJson {
  display: string;
  resources: TimelineActivityResource[];
}

type TraversableJson = readonly unknown[] | Readonly<Record<string, unknown>>;

export function timelineActivityJson(source: string | null): TimelineActivityJson | null {
  if (source === null || source.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(source);
    return { display: JSON.stringify(parsed, null, 2), resources: collectResources(parsed) };
  } catch {
    return { display: source, resources: [] };
  }
}

function collectResources(value: unknown): TimelineActivityResource[] {
  const resources: TimelineActivityResource[] = [];
  const pending: unknown[] = [value];
  const visited = new Set<TraversableJson>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      if (visited.has(current)) continue;
      visited.add(current);
      for (const item of current) pending.push(item);
      continue;
    }
    if (!isRecord(current) || visited.has(current)) continue;
    visited.add(current);
    const resource = resourceFromRecord(current);
    if (resource !== null) resources.push(resource);
    for (const child of Object.values(current)) {
      if (typeof child === "object" && child !== null) pending.push(child);
    }
  }
  return uniqueResources(resources);
}

function resourceFromRecord(
  value: Readonly<Record<string, unknown>>,
): TimelineActivityResource | null {
  const type = typeof value["type"] === "string" ? value["type"] : "";
  const label = resourceLabel(value);
  const image = firstString(value, ["image_url", "imageUrl"]);
  if (image !== null) return { kind: "image", label, value: image };
  const audio = firstString(value, ["audio_url", "audioUrl"]);
  if (audio !== null) return { kind: "audio", label, value: audio };
  const uri = firstString(value, ["uri", "url", "href"]);
  if (uri !== null) {
    if (type === "image") return { kind: "image", label, value: uri };
    if (type === "audio") return { kind: "audio", label, value: uri };
    return { kind: "link", label, value: uri };
  }
  const text = typeof value["text"] === "string" ? value["text"] : null;
  if (text !== null && (type === "text" || type === "resource")) {
    return { kind: "text", label, value: text };
  }
  return null;
}

function resourceLabel(value: Readonly<Record<string, unknown>>): string {
  return firstString(value, ["title", "name", "label", "alt"]) ?? "Resource";
}

function firstString(value: Readonly<Record<string, unknown>>, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return null;
}

function uniqueResources(resources: TimelineActivityResource[]): TimelineActivityResource[] {
  const unique: TimelineActivityResource[] = [];
  const keys = new Set<string>();
  for (const resource of resources) {
    const key = `${resource.kind}\u0000${resource.value}`;
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(resource);
  }
  return unique;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
