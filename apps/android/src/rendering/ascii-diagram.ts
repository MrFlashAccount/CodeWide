const UNICODE_CONNECTOR_PATTERN = /[┌┐└┘├┤┬┴┼│─━┃╭╮╯╰╱╲]/gu;
const UNICODE_ARROW_PATTERN = /[▲▼◀▶←→↑↓]/gu;
const ASCII_CONNECTOR_PATTERN = /(?:[-=+|.']{3,}|(?:<[-=]+|[-=]+>))/gu;
const ASCII_ARROW_PATTERN = /(?:<[-=]+|[-=]+>|\^[ |+]*$|^[ |+]*v)/gmu;

const PLAIN_TEXT_LANGUAGES = new Set(["", "text", "txt", "plaintext", "plain", "ascii", "diagram"]);

/**
 * Detects diagrams conservatively so source code never silently changes
 * presentation. Unicode box drawing is a strong signal; ASCII-only diagrams
 * additionally require an untyped/plain-text fence.
 */
export function looksLikeAsciiDiagram(source: string, language: string | null | undefined): boolean {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  if (lines.length < 4 || source.length > 128 * 1024) return false;

  const unicodeConnectors = source.match(UNICODE_CONNECTOR_PATTERN)?.length ?? 0;
  const unicodeArrows = source.match(UNICODE_ARROW_PATTERN)?.length ?? 0;
  const connectorLines = lines.filter((line) => /[┌┐└┘├┤┬┴┼│─━┃╭╮╯╰╱╲]/u.test(line)).length;
  if (unicodeConnectors >= 4 && unicodeArrows >= 1 && connectorLines >= 3) return true;

  const normalizedLanguage = (language ?? "").trim().toLocaleLowerCase().replace(/^language-/u, "");
  if (!PLAIN_TEXT_LANGUAGES.has(normalizedLanguage)) return false;
  const asciiConnectors = source.match(ASCII_CONNECTOR_PATTERN)?.length ?? 0;
  const asciiArrows = source.match(ASCII_ARROW_PATTERN)?.length ?? 0;
  const asciiConnectorLines = lines.filter((line) => /(?:[-=+|.']{3,}|(?:<[-=]+|[-=]+>))/u.test(line)).length;
  return asciiConnectors >= 3 && asciiArrows >= 1 && asciiConnectorLines >= 3;
}

export function themedAsciiDiagramSvg(source: string): string {
  const theme = `
.svgbob { background: transparent; }
.svgbob line, .svgbob path, .svgbob circle, .svgbob rect, .svgbob polygon { stroke: #9aa7b4; }
.svgbob text { fill: #eef2f6; font-family: "JetBrains Mono", "Roboto Mono", monospace; }
.svgbob rect.backdrop { fill: transparent; stroke: none; }
.svgbob .filled { fill: #9aa7b4; }
.svgbob .bg_filled, .svgbob .nofill { fill: #171b20; }
`;
  const themed = source.replace("</style>", `${theme}</style>`);
  return /<svg\b[^>]*\bclass=/u.test(themed)
    ? themed.replace(/<svg\b([^>]*\bclass=["'])/u, '<svg$1svgbob ')
    : themed.replace("<svg", '<svg class="svgbob"');
}
