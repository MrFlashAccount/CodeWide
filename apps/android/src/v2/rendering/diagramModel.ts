type DiagramKind = "ascii" | "mermaid";

export interface DiagramEngine {
  assetUri: string;
  kind: DiagramKind;
  renderFunction: "renderAsciiDiagram" | "renderMermaid";
  title: string;
}

export const MERMAID_ENGINE: DiagramEngine = {
  assetUri: "file:///android_asset/mermaid-renderer.html",
  kind: "mermaid",
  renderFunction: "renderMermaid",
  title: "Mermaid",
};

export const ASCII_ENGINE: DiagramEngine = {
  assetUri: "file:///android_asset/ascii-diagram-renderer.html",
  kind: "ascii",
  renderFunction: "renderAsciiDiagram",
  title: "Diagram",
};

export const MAX_DIAGRAM_SOURCE_CHARS = 128 * 1024;

export function diagramRevision(source: string): string {
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash) ^ (source.codePointAt(index) ?? 0);
  }
  return Math.abs(hash).toString(36);
}

export interface DiagramRendererMessage {
  height?: number;
  message?: string;
  requestId?: number;
  type?: string;
  x?: number;
  y?: number;
}

export function parseDiagramRendererMessage(value: string): DiagramRendererMessage | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function diagramRendererCommand(
  engine: DiagramEngine,
  source: string,
  requestId: number,
  mode: "fullscreen" | "inline",
): string {
  const functionName = engine.renderFunction;
  return (
    `(() => {\n` +
    `if (typeof window.${functionName} !== 'function') {\n` +
    `window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',requestId:${requestId},message:'Bundled renderer did not initialize'}));\n` +
    `return;\n}\n` +
    `window.${functionName}(${JSON.stringify(source)},${requestId},${JSON.stringify(mode)});\n` +
    `})();true;`
  );
}

export function looksLikeAsciiDiagram(
  source: string,
  language: string | null | undefined,
): boolean {
  if (source.length > MAX_DIAGRAM_SOURCE_CHARS) return false;
  const lines = source.replaceAll(/\r\n?/gu, "\n").split("\n");
  if (lines.length < 4) return false;
  const unicodeSignals = source.match(/[┌┐└┘├┤┬┴┼│─━┃╭╮╯╰╱╲▲▼◀▶←→↑↓]/gu)?.length ?? 0;
  if (unicodeSignals >= 5) return true;
  const normalizedLanguage = (language ?? "").trim().toLocaleLowerCase();
  if (!["", "ascii", "diagram", "plain", "plaintext", "text", "txt"].includes(normalizedLanguage)) {
    return false;
  }
  const connectorLines = lines.filter((line) => /[-=+|.']{3,}|<[-=]+|[-=]+>/u.test(line)).length;
  return connectorLines >= 3;
}
