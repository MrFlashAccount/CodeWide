import { marked, type Token, type Tokens } from "marked";

const MARKED_OPTIONS = { gfm: true, breaks: false } as const;
const INLINE_HAZARD = /!\[|\[|`|\*|_|~~|</u;

export type LiveMarkdownTailProjection = {
  visible: string;
  pending: string;
};

/**
 * Returns the source prefix whose current Marked interpretation is safe to
 * expose while more bytes may still arrive. Marked remains the only Markdown
 * lexer: this layer merely decides how much of its final mutable token may be
 * committed to the live renderer.
 */
export function projectLiveMarkdownTail(source: string, complete = false): LiveMarkdownTailProjection {
  if (source === "" || complete) return { visible: source, pending: "" };

  const tokens = marked.lexer(source, MARKED_OPTIONS);
  let offset = 0;
  const content: Array<{ token: Token; start: number; index: number }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.type !== "space") content.push({ token, start: offset, index });
    offset += token.raw.length;
  }
  if (content.length === 0) return { visible: source, pending: "" };

  for (let contentIndex = 0; contentIndex < content.length; contentIndex += 1) {
    const current = content[contentIndex]!;
    const trailing = tokens.slice(current.index + 1);
    const terminated = contentIndex < content.length - 1
      || trailing.some((token) => token.type === "space" && /\n\s*\n/u.test(token.raw));
    const stablePrefix = stableTokenPrefix(current.token, terminated);
    if (stablePrefix >= current.token.raw.length) continue;
    const boundary = Math.max(0, Math.min(source.length, current.start + stablePrefix));
    return { visible: source.slice(0, boundary), pending: source.slice(boundary) };
  }
  return { visible: source, pending: "" };
}

function stableTokenPrefix(token: Token, terminated: boolean): number {
  if (token.type === "code") {
    const code = token as Tokens.Code;
    if (codeLanguage(code) === "mermaid") return hasClosingFence(code.raw) ? code.raw.length : 0;
    return completedLineBoundary(code.raw);
  }
  if (token.type === "table") return stableTablePrefix(token.raw);
  if (token.type === "def") return token.raw.length;
  if (token.type === "paragraph" || token.type === "text" || token.type === "heading") {
    if (!terminated && looksLikePotentialTableHeader(token.raw)) return 0;
    return stableInlinePrefix(token, terminated);
  }
  if (token.type === "html") return terminated ? token.raw.length : 0;
  if (terminated) return token.raw.length;
  return completedLineBoundary(token.raw);
}

function stableInlinePrefix(token: Token, terminated: boolean): number {
  const children = "tokens" in token && Array.isArray(token.tokens) ? token.tokens : [];
  if (children.length === 0) return completedWordBoundary(token.raw);

  const inlineRaw = children.map((child) => child.raw).join("");
  const bodyStart = token.raw.indexOf(inlineRaw);
  if (bodyStart < 0) return completedWordBoundary(token.raw);

  let consumed = 0;
  for (const child of children) {
    if (child.type === "text") {
      const hazard = child.raw.search(INLINE_HAZARD);
      if (hazard >= 0) {
        const prefix = consumed + hazard;
        return prefix === 0 ? 0 : bodyStart + prefix;
      }
    }
    consumed += child.raw.length;
  }

  if (terminated) return token.raw.length;
  const last = children.at(-1)!;
  if (last.type !== "text") return bodyStart + consumed;
  const stableLast = completedWordBoundary(last.raw);
  const prefix = consumed - last.raw.length + stableLast;
  return prefix === 0 ? 0 : bodyStart + prefix;
}

function stableTablePrefix(raw: string): number {
  const firstLineEnd = raw.indexOf("\n");
  if (firstLineEnd < 0) return 0;
  const delimiterLineEnd = raw.indexOf("\n", firstLineEnd + 1);
  // Marked only emits a table after recognizing the delimiter row. If no body
  // row has started yet, the header and delimiter are already semantic.
  if (delimiterLineEnd < 0) return raw.length;
  if (raw.endsWith("\n")) return raw.length;
  return raw.lastIndexOf("\n") + 1;
}

function looksLikePotentialTableHeader(raw: string): boolean {
  const line = raw.trimEnd();
  if (line.includes("\n")) return false;
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.slice(1).includes("|");
}

function codeLanguage(token: Tokens.Code): string {
  return (token.lang ?? "").trim().split(/\s/u, 1)[0]?.toLocaleLowerCase() ?? "";
}

function hasClosingFence(raw: string): boolean {
  const firstLineEnd = raw.indexOf("\n");
  if (firstLineEnd < 0) return false;
  const opener = /^ {0,3}(`{3,}|~{3,})/u.exec(raw.slice(0, firstLineEnd));
  if (opener === null) return false;
  const marker = opener[1]!;
  const closing = new RegExp(`^ {0,3}${escapeRegExp(marker[0]!)}{${marker.length},}[ \\t]*$`, "u");
  return raw.slice(firstLineEnd + 1).split("\n").some((line) => closing.test(line));
}

function completedLineBoundary(raw: string): number {
  if (raw.endsWith("\n")) return raw.length;
  const newline = raw.lastIndexOf("\n");
  return newline < 0 ? 0 : newline + 1;
}

function completedWordBoundary(raw: string): number {
  if (/\s$/u.test(raw)) return raw.length;
  const match = /\s+\S*$/u.exec(raw);
  return match === null ? 0 : match.index + match[0].search(/\S/u);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
