const UNICODE_CONNECTOR_PATTERN = /[┌┐└┘├┤┬┴┼│─━┃╭╮╯╰╱╲]/gu;
const UNICODE_ARROW_PATTERN = /[▲▼◀▶←→↑↓]/gu;
const ASCII_CONNECTOR_PATTERN = /(?:[-=+|.']{3,}|(?:<[-=]+|[-=]+>))/gu;
const ASCII_ARROW_PATTERN = /(?:<[-=]+|[-=]+>|\^[ |+]*$|^[ |+]*v)/gmu;

const PLAIN_TEXT_LANGUAGES = new Set(["", "text", "txt", "plaintext", "plain", "ascii", "diagram"]);
const SVGBOB_CELL_WIDTH = 8;
const SVG_TEXT_PATTERN = /<text\b([^>]*)>([\s\S]*?)<\/text>/gu;

type SvgTextFragment = {
  attributes: string;
  decoded: string;
  end: number;
  start: number;
  x: number;
  y: number;
};

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

function decodeXmlText(value: string): string {
  return value.replace(/&(?:#x([\da-f]+)|#(\d+)|(amp|apos|gt|lt|quot));/giu, (entity, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal !== undefined) return String.fromCodePoint(Number.parseInt(decimal, 10));
    switch (named?.toLocaleLowerCase()) {
      case "amp": return "&";
      case "apos": return "'";
      case "gt": return ">";
      case "lt": return "<";
      case "quot": return '"';
      default: return entity;
    }
  });
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function utf8Width(value: string): number {
  const codePoint = value.codePointAt(0) ?? 0;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function numericSvgAttribute(attributes: string, name: string): number | null {
  const match = new RegExp(`\\b${name}=["']([\\d.-]+)["']`, "u").exec(attributes);
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function replaceSvgAttribute(attributes: string, name: string, value: string): string {
  return attributes.replace(new RegExp(`(\\b${name}=)(["'])[^"']*\\2`, "u"), `$1"${value}"`);
}

/**
 * Svgbob 0.6.x and the current 0.7.x release calculate CellText length with
 * UTF-8 byte length. A Cyrillic word is consequently emitted as two
 * interleaved SVG text nodes (even and odd cells), which overlap when painted.
 * Reassemble only those overlapping non-ASCII fragments at the SVG boundary.
 * Latin labels and explicitly quoted/verbatim labels stay untouched.
 */
export function repairSvgbobUnicodeText(source: string): string {
  const fragments: SvgTextFragment[] = [];
  for (const match of source.matchAll(SVG_TEXT_PATTERN)) {
    const attributes = match[1] ?? "";
    const content = match[2] ?? "";
    const x = numericSvgAttribute(attributes, "x");
    const y = numericSvgAttribute(attributes, "y");
    if (x === null || y === null || match.index === undefined) continue;
    const decoded = decodeXmlText(content);
    if (!/[^\u0000-\u007f]/u.test(decoded)) continue;
    fragments.push({ attributes, decoded, end: match.index + match[0].length, start: match.index, x, y });
  }
  if (fragments.length < 2) return source;

  const parent = fragments.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]!));
  const unite = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const range = (fragment: SvgTextFragment) => ({
    start: fragment.x,
    end: fragment.x + Array.from(fragment.decoded).reduce((width, character) => width + utf8Width(character) * SVGBOB_CELL_WIDTH, 0),
  });
  for (let left = 0; left < fragments.length; left += 1) {
    const leftFragment = fragments[left]!;
    const leftRange = range(leftFragment);
    for (let right = left + 1; right < fragments.length; right += 1) {
      const rightFragment = fragments[right]!;
      if (leftFragment.y !== rightFragment.y) continue;
      const rightRange = range(rightFragment);
      if (leftRange.start < rightRange.end && rightRange.start < leftRange.end) unite(left, right);
    }
  }

  const groups = new Map<number, SvgTextFragment[]>();
  for (let index = 0; index < fragments.length; index += 1) {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(fragments[index]!);
    groups.set(root, group);
  }

  const replacements = new Map<number, { end: number; value: string }>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const cells = new Map<number, string>();
    for (const fragment of group) {
      let x = fragment.x;
      for (const character of Array.from(fragment.decoded)) {
        cells.set(x, character);
        x += utf8Width(character) * SVGBOB_CELL_WIDTH;
      }
    }
    const occupied = [...cells.entries()].sort(([left], [right]) => left - right);
    const ordered: Array<[number, string]> = [];
    for (let x = occupied[0]![0]; x <= occupied[occupied.length - 1]![0]; x += SVGBOB_CELL_WIDTH) {
      ordered.push([x, cells.get(x) ?? " "]);
    }
    const leftmost = group.reduce((current, fragment) => fragment.x < current.x ? fragment : current);
    const keeper = group.reduce((current, fragment) => fragment.start < current.start ? fragment : current);
    const attributes = replaceSvgAttribute(leftmost.attributes, "x", ordered.map(([x]) => x).join(" "));
    const content = ordered.map(([, character]) => character).join("");
    replacements.set(keeper.start, { end: keeper.end, value: `<text${attributes}>${escapeXmlText(content)}</text>` });
    for (const fragment of group) {
      if (fragment !== keeper) replacements.set(fragment.start, { end: fragment.end, value: "" });
    }
  }
  if (replacements.size === 0) return source;

  let result = "";
  let cursor = 0;
  for (const [start, replacement] of [...replacements.entries()].sort(([left], [right]) => left - right)) {
    result += source.slice(cursor, start) + replacement.value;
    cursor = replacement.end;
  }
  return result + source.slice(cursor);
}

export function themedAsciiDiagramSvg(source: string): string {
  const theme = `
.svgbob { background: transparent; }
.svgbob line, .svgbob path, .svgbob circle, .svgbob rect, .svgbob polygon { stroke: #9aa7b4; }
.svgbob text { fill: #eef2f6; font-family: "JetBrains Mono", "Roboto Mono", monospace; font-size: 13.333px; white-space: pre; }
.svgbob rect.backdrop { fill: transparent; stroke: none; }
.svgbob .filled { fill: #9aa7b4; }
.svgbob .bg_filled, .svgbob .nofill { fill: #171b20; }
`;
  const themed = repairSvgbobUnicodeText(source).replace("</style>", `${theme}</style>`);
  return /<svg\b[^>]*\bclass=/u.test(themed)
    ? themed.replace(/<svg\b([^>]*\bclass=["'])/u, '<svg$1svgbob ')
    : themed.replace("<svg", '<svg class="svgbob"');
}
