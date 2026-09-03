export interface ExtensionCardModel {
  detail: string | null;
  label: string;
}

const LABELS: Record<string, string> = {
  "memory-citation": "Memory citation",
  "tool-result": "Tool result",
  tool: "Tool",
  "web-search": "Web search",
};

export function extensionCardModel(
  kind: string,
  meta: string | null,
  value: string,
): ExtensionCardModel | null {
  const label = LABELS[kind];
  if (label === undefined) return null;
  const parsed = parseRecord(value);
  const title =
    stringField(parsed, "title") ?? stringField(parsed, "query") ?? stringField(parsed, "name");
  const detail = title ?? boundedText(value);
  return {
    detail: detail === "" ? null : detail,
    label: meta === null ? label : `${label} · ${meta}`,
  };
}

function parseRecord(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}

function stringField(record: unknown, key: string): string | null {
  const value =
    record !== null && typeof record === "object" && !Array.isArray(record)
      ? Reflect.get(record, key)
      : undefined;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function boundedText(value: string): string {
  const normalized = value.trim();
  return normalized.length <= 4000 ? normalized : `${normalized.slice(0, 4000)}…`;
}
