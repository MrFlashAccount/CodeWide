export type DevToolsDockSide = "bottom" | "left" | "right" | "undocked";

/** Validated message accepted from the embedded browser DevTools surface. */
export type DevToolsMessage =
  | { source: "codewide-devtools-health"; state: "ready" | "error"; message?: string }
  | { source: "codewide-devtools-dock"; side: DevToolsDockSide }
  | {
      source: "codewide-devtools-transport";
      event: "open" | "close" | "error";
      code: number;
      reason: string;
    };

export function parseDevToolsMessage(value: string): DevToolsMessage | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") return null;
    const source = "source" in parsed ? parsed.source : undefined;
    if (source === "codewide-devtools-dock") {
      const side = "side" in parsed ? parsed.side : undefined;
      return isDevToolsDockSide(side) ? { source, side } : null;
    }
    if (source === "codewide-devtools-transport") {
      const event = "event" in parsed ? parsed.event : undefined;
      if (event !== "open" && event !== "close" && event !== "error") return null;
      const code = "code" in parsed ? parsed.code : undefined;
      const reason = "reason" in parsed ? parsed.reason : undefined;
      return {
        source,
        event,
        code: typeof code === "number" ? code : 0,
        reason: typeof reason === "string" ? reason : "",
      };
    }
    if (source !== "codewide-devtools-health") return null;
    const state = "state" in parsed ? parsed.state : undefined;
    if (state !== "ready" && state !== "error") return null;
    const message = "message" in parsed ? parsed.message : undefined;
    return { source, state, ...(typeof message === "string" ? { message } : {}) };
  } catch {
    return null;
  }
}

function isDevToolsDockSide(value: unknown): value is DevToolsDockSide {
  return value === "bottom" || value === "left" || value === "right" || value === "undocked";
}

export function redactDevToolsUrl(url: string): string {
  return url
    .replace(/\/browser-devtools\/[^/]+\//u, "/browser-devtools/<redacted>/")
    .replace(/([?&]codewide_token=)[^&]+/gu, "$1<redacted>");
}
