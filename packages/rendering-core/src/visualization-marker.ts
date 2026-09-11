import type { TokenizerExtension, Tokens } from "marked";

const OPEN = "\uE200visualize\uE202";
const CLOSE = "\uE201";

/** Identifies visualization links; the file kind owns their normal preview surface. */
export const VISUALIZATION_FRAGMENT = "#codewide-visualization";

function visualizationToken(source: string): Tokens.Link | undefined {
  if (!source.startsWith(OPEN)) return undefined;
  const end = source.indexOf(CLOSE, OPEN.length);
  if (end < 0) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(source.slice(OPEN.length, end));
  } catch {
    return undefined;
  }
  if (typeof payload !== "object" || payload === null || !("path" in payload)) return undefined;
  const path = payload.path;
  if (typeof path !== "string" || !/\.(?:html?|xhtml)$/iu.test(path)
    || /[\u0000-\u001f\u007f]/u.test(path) || path.startsWith("//")
    || /^[a-z][a-z\d+.-]*:/iu.test(path.trimStart())) return undefined;
  const text = `Open visualization · ${path.split("/").at(-1) ?? "HTML"}`;
  const escapedText = text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  let href: string;
  try {
    href = `${path.split("/").map(encodeURIComponent).join("/")}${VISUALIZATION_FRAGMENT}`;
  } catch {
    // JSON permits isolated UTF-16 surrogates, but a file URL cannot encode them.
    return undefined;
  }
  return {
    type: "link",
    raw: source.slice(0, end + CLOSE.length),
    href,
    text,
    tokens: [{ type: "text", raw: text, text: escapedText }],
  };
}

/** Recognize complete markers before Markdown can split their JSON into tokens.
 * Code spans/fences stay literal because the Markdown lexer owns those contexts.
 */
export const visualizationExtension: TokenizerExtension = {
  name: "cwVisualization",
  level: "inline",
  start: (source) => source.indexOf(OPEN),
  tokenizer: visualizationToken,
};
