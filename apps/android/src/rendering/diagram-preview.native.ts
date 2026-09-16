import { NativeModules } from "react-native";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { parseDiagramPreviewResult, type DiagramPreviewResult } from "./diagram-preview-result";
import { checkAborted } from "../native/check-aborted";

let sequence = 0;
const MAX_RENDER_ATTEMPTS = 3;

type DiagramPreviewBridge = {
  cancel: (id: string) => void;
  render: (id: string, source: string) => Promise<unknown>;
};

export function diagramPreviewKey(source: string): string {
  return `diagram-svg:${bytesToHex(sha256(utf8ToBytes(source)))}`;
}

export async function renderDiagramPreview(
  source: string,
  signal: AbortSignal,
): Promise<DiagramPreviewResult> {
  const bridge: unknown = NativeModules.CodeWideDiagramPreview;
  if (!isDiagramPreviewBridge(bridge)) {
    throw new Error("Diagram previews require an updated Android app");
  }
  checkAborted(signal);
  for (let attempt = 1; attempt <= MAX_RENDER_ATTEMPTS; attempt += 1) {
    const id = String(++sequence);
    const cancelRequest = bridge.cancel;
    const cancel = (): void => {
      cancelRequest.call(bridge, id);
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const result: unknown = await bridge.render(id, source);
      checkAborted(signal);
      if (typeof result !== "string") {
        throw new Error("Invalid diagram renderer response");
      }
      return parseDiagramPreviewResult(result);
    } catch (error) {
      checkAborted(signal);
      if (attempt === MAX_RENDER_ATTEMPTS || !isRetryableRendererFailure(error)) {
        throw error;
      }
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
  throw new Error("Diagram renderer exhausted its retry limit");
}

function isDiagramPreviewBridge(value: unknown): value is DiagramPreviewBridge {
  return (
    typeof value === "object" &&
    value !== null &&
    "render" in value &&
    typeof value.render === "function" &&
    "cancel" in value &&
    typeof value.cancel === "function"
  );
}

function isRetryableRendererFailure(cause: unknown): boolean {
  return cause instanceof Error && Reflect.get(cause, "code") === "DIAGRAM_PREVIEW_FAILED";
}
