import type { NormalizedItem } from "@codewide/domain";

export type RenderTone = "neutral" | "info" | "success" | "warning" | "danger";

export type RenderBlock = {
  key: string;
  kind: string;
  title: string;
  body: string | null;
  status: string | null;
  durationMs: number | null;
  tone: RenderTone;
  collapsible: boolean;
  raw: Record<string, unknown>;
  content: RenderContentProjection | null;
};

export type RenderContentReference = {
  id: string;
  byteLength: number;
  contentType: string;
  encoding: "utf-8";
};

export type RenderContentProjection = {
  fields: Record<string, RenderContentReference>;
  whole: RenderContentReference | null;
};

type Payload = Record<string, unknown>;
type Renderer = (item: NormalizedItem, payload: Payload) => Omit<RenderBlock, "key" | "kind" | "raw" | "content">;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const number = (value: unknown): number | null => (typeof value === "number" ? value : null);
const statusTone = (status: string | null): RenderTone => {
  if (status === null) return "neutral";
  if (["completed", "success"].includes(status)) return "success";
  if (["failed", "declined", "error"].includes(status)) return "danger";
  if (["inProgress", "running"].includes(status)) return "info";
  return "neutral";
};
const compactJson = (value: unknown): string => {
  const serialized = boundedJson(value, 8_192);
  return serialized.length > 8_192 ? `${serialized.slice(0, 8_192)}\n…` : serialized;
};
const markdownFragments = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null;
  const fragments = value.flatMap((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [];
    const fragment = entry as Record<string, unknown>;
    return typeof fragment.text === "string" ? [fragment.text] : [];
  });
  return fragments.length === 0 ? null : fragments.join("\n\n");
};
const reasoningBody = (payload: Payload): string | null => {
  for (const value of [payload.summary, payload.content]) {
    if (!Array.isArray(value)) continue;
    const parts = value.filter((part): part is string => typeof part === "string" && part.trim() !== "");
    if (parts.length > 0) return parts.join("\n");
  }
  return null;
};

export const renderRegistry = {
  userMessage: ((_item, payload) => ({
    title: "You",
    body: compactJson(payload.content ?? []),
    status: null,
    durationMs: null,
    tone: "info",
    collapsible: false,
  })) satisfies Renderer,
  hookPrompt: ((_item, payload) => ({
    title: "Hook prompt",
    body: markdownFragments(payload.fragments),
    status: null,
    durationMs: null,
    tone: "warning",
    collapsible: true,
  })) satisfies Renderer,
  agentMessage: ((_item, payload) => ({
    title: "Codex",
    body: text(payload.text),
    status: text(payload.phase),
    durationMs: null,
    tone: "neutral",
    collapsible: false,
  })) satisfies Renderer,
  plan: ((_item, payload) => ({
    title: "Plan",
    body: text(payload.text),
    status: null,
    durationMs: null,
    tone: "info",
    collapsible: true,
  })) satisfies Renderer,
  reasoning: ((_item, payload) => ({
    title: "Reasoning",
    body: reasoningBody(payload),
    status: null,
    durationMs: null,
    tone: "neutral",
    collapsible: true,
  })) satisfies Renderer,
  commandExecution: ((_item, payload) => {
    const status = text(payload.status);
    return {
      title: text(payload.command) ?? "Command",
      body: text(payload.aggregatedOutput),
      status,
      durationMs: number(payload.durationMs),
      tone: statusTone(status),
      collapsible: true,
    };
  }) satisfies Renderer,
  fileChange: ((_item, payload) => {
    const status = text(payload.status);
    return {
      title: "File changes",
      body: compactJson(payload.changes ?? []),
      status,
      durationMs: null,
      tone: statusTone(status),
      collapsible: true,
    };
  }) satisfies Renderer,
  mcpToolCall: ((_item, payload) => {
    const status = text(payload.status);
    return {
      title: `${text(payload.server) ?? "MCP"} · ${text(payload.tool) ?? "tool"}`,
      body: compactJson(payload.result ?? payload.arguments ?? null),
      status,
      durationMs: number(payload.durationMs),
      tone: statusTone(status),
      collapsible: true,
    };
  }) satisfies Renderer,
  dynamicToolCall: ((_item, payload) => {
    const status = text(payload.status);
    return {
      title: text(payload.tool) ?? "Dynamic tool",
      body: compactJson(payload.contentItems ?? payload.arguments ?? null),
      status,
      durationMs: number(payload.durationMs),
      tone: statusTone(status),
      collapsible: true,
    };
  }) satisfies Renderer,
  collabAgentToolCall: ((_item, payload) => {
    const status = text(payload.status);
    return {
      title: `Agent · ${text(payload.tool) ?? "collaboration"}`,
      body: text(payload.prompt) ?? compactJson(payload.agentsStates ?? {}),
      status,
      durationMs: null,
      tone: statusTone(status),
      collapsible: true,
    };
  }) satisfies Renderer,
  subAgentActivity: ((_item, payload) => ({
    title: "Subagent activity",
    body: text(payload.agentPath),
    status: text(payload.kind),
    durationMs: null,
    tone: "info",
    collapsible: true,
  })) satisfies Renderer,
  webSearch: ((_item, payload) => ({
    title: "Web search",
    body: compactJson(payload.action ?? payload),
    status: null,
    durationMs: null,
    tone: "info",
    collapsible: true,
  })) satisfies Renderer,
  imageView: ((_item, payload) => ({
    title: "Image",
    body: text(payload.path),
    status: null,
    durationMs: null,
    tone: "neutral",
    collapsible: false,
  })) satisfies Renderer,
  sleep: ((_item, payload) => ({
    title: "Wait",
    body: compactJson(payload),
    status: null,
    durationMs: number(payload.durationMs),
    tone: "neutral",
    collapsible: true,
  })) satisfies Renderer,
  imageGeneration: ((_item, payload) => ({
    title: "Generated image",
    body: text(payload.revisedPrompt) ?? compactJson(payload),
    status: text(payload.status),
    durationMs: null,
    tone: "success",
    collapsible: false,
  })) satisfies Renderer,
  enteredReviewMode: ((_item, payload) => ({
    title: "Entered review mode",
    body: text(payload.review),
    status: null,
    durationMs: null,
    tone: "info",
    collapsible: true,
  })) satisfies Renderer,
  exitedReviewMode: ((_item, payload) => ({
    title: "Exited review mode",
    body: text(payload.review),
    status: null,
    durationMs: null,
    tone: "neutral",
    collapsible: true,
  })) satisfies Renderer,
  contextCompaction: ((_item, payload) => {
    const running = payload.codewideLifecyclePhase === "started";
    return {
      title: running ? "Compacting context" : "Context compacted",
      body: null,
      status: running ? "inProgress" : "completed",
      durationMs: null,
      tone: running ? "info" : "neutral",
      collapsible: false,
    };
  }) satisfies Renderer,
} satisfies Record<string, Renderer>;

export function toRenderBlock(item: NormalizedItem): RenderBlock {
  const payload = item.payload as unknown as Payload;
  const renderer = renderRegistry[item.type as keyof typeof renderRegistry] as Renderer | undefined;
  if (renderer === undefined) {
    return {
      key: item.key,
      kind: "unknown",
      title: `Unsupported block · ${item.type}`,
      body: compactJson(payload),
      status: null,
      durationMs: null,
      tone: "warning",
      collapsible: true,
      raw: payload,
      content: contentProjection(payload),
    };
  }
  return {
    key: item.key,
    kind: item.type,
    ...renderer(item, payload),
    raw: payload,
    content: contentProjection(payload),
  };
}

function contentProjection(payload: Payload): RenderContentProjection | null {
  const metadata = objectValue(payload.codewideContent);
  const fieldsValue = objectValue(metadata?.fields);
  if (metadata?.version !== 1 || fieldsValue === null) return null;
  const fields = Object.fromEntries(Object.entries(fieldsValue).flatMap(([pointer, value]) => {
    const reference = contentReference(value);
    return reference === null ? [] : [[pointer, reference]];
  }));
  const whole = contentReference(metadata.whole);
  return Object.keys(fields).length === 0 && whole === null ? null : { fields, whole };
}

function contentReference(value: unknown): RenderContentReference | null {
  const reference = objectValue(value);
  if (
    reference === null
    || typeof reference.id !== "string"
    || !/^[a-f0-9]{64}$/.test(reference.id)
    || typeof reference.byteLength !== "number"
    || !Number.isSafeInteger(reference.byteLength)
    || reference.byteLength < 0
    || typeof reference.contentType !== "string"
    || reference.encoding !== "utf-8"
  ) return null;
  return {
    id: reference.id,
    byteLength: reference.byteLength,
    contentType: reference.contentType,
    encoding: "utf-8",
  };
}

function boundedJson(value: unknown, maxChars: number): string {
  const remaining = { chars: maxChars, nodes: 1_000 };
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown, depth: number): unknown => {
    if (remaining.chars <= 0 || remaining.nodes <= 0) return "…";
    remaining.nodes -= 1;
    if (typeof candidate === "string") {
      const take = Math.min(candidate.length, remaining.chars);
      remaining.chars -= take;
      return take === candidate.length ? candidate : `${candidate.slice(0, Math.max(0, take - 1))}…`;
    }
    if (candidate === null || typeof candidate === "number" || typeof candidate === "boolean") return candidate;
    if (typeof candidate !== "object") return String(candidate ?? "null");
    if (depth >= 10 || seen.has(candidate)) return "…";
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.slice(0, 100).map((entry) => visit(entry, depth + 1));
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(candidate)) {
      if (remaining.chars <= 0 || remaining.nodes <= 0) break;
      result[key] = visit(child, depth + 1);
    }
    return result;
  };
  return JSON.stringify(visit(value, 0), null, 2) ?? "null";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
