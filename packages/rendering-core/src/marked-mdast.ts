import { decodeNamedCharacterReference } from "decode-named-character-reference";
import { Marked, type Token, type Tokens } from "marked";
import { visualizationExtension } from "./visualization-marker";
import type {
  BlockContent,
  DefinitionContent,
  FootnoteDefinition,
  Html,
  ListItem,
  PhrasingContent,
  Root,
  Table,
  TableCell,
  TableRow,
} from "mdast";

const MARKED_OPTIONS = { gfm: true, breaks: false } as const;
const MESSAGE_MARKUP_HTML = "codewideMessageMarkupHtml";
const VOID_HTML_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

function mathToken(source: string, block: boolean): Token | undefined {
  const pairs = block ? [["$$", "$$"], ["\\[", "\\]"]] : [["\\(", "\\)"], ["$", "$"]];
  for (const [opening = "", closing = ""] of pairs) {
    if (!source.startsWith(opening) || (!block && source.startsWith("$$"))) continue;
    if (opening === "$" && /\s/u.test(source[1] ?? "")) continue;
    let end = opening.length;
    while ((end = source.indexOf(closing, end)) >= 0) {
      let slashCount = 0;
      for (let index = end - 1; index >= 0 && source[index] === "\\"; index -= 1) slashCount += 1;
      if (slashCount % 2 === 0) break;
      end += closing.length;
    }
    if (end < 0) continue;
    const text = source.slice(opening.length, end);
    if (opening === "$" && (/\n|\s$/u.test(text) || /\d/u.test(source[end + 1] ?? ""))) continue;
    if (text.trim() === "") continue;
    return { type: block ? "cwDisplayMath" : "cwInlineMath", raw: source.slice(0, end + closing.length), text };
  }
  return undefined;
}

const marked = new Marked(MARKED_OPTIONS, {
  extensions: [
    visualizationExtension,
    { name: "cwDisplayMath", level: "block", start: (source) => source.search(/\$\$|\\\[/u), tokenizer: (source) => mathToken(source, true), renderer: (token) => `<cw-display-math>${escapeHtml(String(token.text))}</cw-display-math>` },
    { name: "cwInlineMath", level: "inline", start: (source) => source.search(/\$|\\\(/u), tokenizer: (source) => mathToken(source, false), renderer: (token) => `<cw-inline-math>${escapeHtml(String(token.text))}</cw-inline-math>` },
  ],
});
const CHARACTER_REFERENCE = /&(#(?:[xX][\dA-Fa-f]+|\d+)|[A-Za-z][\dA-Za-z]+);/gu;
const FOOTNOTE_REFERENCE = /\[\^([^\]]+)\]/gu;

type ParseContext = { footnotes: ReadonlySet<string> };

export function markedMarkdownRoot(source: string): Root {
  const extracted = extractFootnotes(source);
  const context = { footnotes: new Set(extracted.definitions.map((definition) => definition.identifier)) };
  return {
    type: "root",
    children: [
      ...blockTokens(marked.lexer(extracted.source), context),
      ...extracted.definitions.map((definition) => footnoteDefinition(definition, context)),
    ],
  };
}

/** Returns the rendered top-level block containing a one-based source line. */
export function markedMarkdownBlockIndexAtLine(source: string, requestedLine: number): number | null {
  if (!Number.isFinite(requestedLine) || requestedLine < 1) return null;
  const extracted = extractFootnotes(source);
  const context = { footnotes: new Set(extracted.definitions.map((definition) => definition.identifier)) };
  const tokens = marked.lexer(extracted.source);
  let sourceLine = 1;
  let blockIndex = 0;
  let lastBlockIndex: number | null = null;
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const endIndex = messageMarkupEndIndex(tokens, tokenIndex) ?? tokenIndex;
    const group = tokens.slice(tokenIndex, endIndex + 1);
    const raw = group.map((token) => token.raw ?? "").join("");
    const newlineCount = raw.split("\n").length - 1;
    const endLine = sourceLine + Math.max(0, newlineCount - (raw.endsWith("\n") ? 1 : 0));
    const blockCount = blockTokens(group, context).length;
    if (blockCount > 0) {
      if (requestedLine <= endLine) return blockIndex;
      lastBlockIndex = blockIndex + blockCount - 1;
      blockIndex += blockCount;
    }
    sourceLine += newlineCount;
    tokenIndex = endIndex;
  }
  return lastBlockIndex;
}

type BlockNode = BlockContent | DefinitionContent;

function blockTokens(tokens: Token[], context: ParseContext): BlockNode[] {
  const result: BlockNode[] = [];
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]!;
    const markupEndIndex = messageMarkupEndIndex(tokens, tokenIndex);
    if (markupEndIndex !== null) {
      result.push(messageMarkupNode(tokens.slice(tokenIndex, markupEndIndex + 1)));
      tokenIndex = markupEndIndex;
      continue;
    }
    switch (token.type) {
      case "space":
      case "def":
      case "checkbox":
        break;
      case "heading":
        result.push({
          type: "heading",
          depth: clampHeadingDepth(token.depth),
          children: inlineTokens(childTokens(token), context),
        });
        break;
      case "paragraph":
        result.push({ type: "paragraph", children: inlineTokens(childTokens(token), context) });
        break;
      case "text":
        result.push({
          type: "paragraph",
          children: childTokens(token).length === 0
            ? textNodes(token.text, context)
            : inlineTokens(childTokens(token), context),
        });
        break;
      case "blockquote":
        result.push({ type: "blockquote", children: blockTokens(childTokens(token), context) });
        break;
      case "list":
        result.push({
          type: "list",
          ordered: token.ordered,
          ...(typeof token.start === "number" ? { start: token.start } : {}),
          spread: token.loose,
          children: token.items.map((item: Tokens.ListItem) => listItem(item, context)),
        });
        break;
      case "code": {
        const info = codeInfo(token.lang);
        result.push({
          type: "code",
          value: token.text,
          ...(info.lang === null ? {} : { lang: info.lang }),
          ...(info.meta === null ? {} : { meta: info.meta }),
        });
        break;
      }
      case "table":
        result.push(table(token as Tokens.Table, context));
        break;
      case "hr":
        result.push({ type: "thematicBreak" });
        break;
      case "html":
        result.push({ type: "html", value: token.text });
        break;
      default: {
        const nested = "tokens" in token && Array.isArray(token.tokens) ? inlineTokens(token.tokens, context) : [];
        const fallback = tokenText(token);
        if (nested.length > 0 || fallback !== "") {
          result.push({
            type: "paragraph",
            children: nested.length > 0 ? nested : [{ type: "text", value: fallback }],
          });
        }
      }
    }
  }
  return result;
}

function messageMarkupEndIndex(tokens: Token[], index: number): number | null {
  const token = tokens[index];
  if (token === undefined) return null;
  if (token.type === "html") {
    const tag = openingContainerTag(token.raw ?? "");
    if (tag === null) return index;
    let balance = htmlTagBalance(token.raw ?? "", tag);
    if (balance <= 0) return index;
    for (let candidate = index + 1; candidate < tokens.length; candidate += 1) {
      const next = tokens[candidate]!;
      if (next.type === "html") balance += htmlTagBalance(next.raw ?? "", tag);
      if (balance <= 0) return candidate;
    }
    return tokens.length - 1;
  }
  if (token.type === "cwDisplayMath" || isMathCode(token)) return index;
  if ((token.type === "paragraph" || token.type === "text" || token.type === "heading" || token.type === "table") && childTokensContainMarkup(token)) return index;
  return null;
}

function openingContainerTag(raw: string): string | null {
  const match = /^\s*<([a-z][a-z\d-]*)\b[^>]*>/iu.exec(raw);
  if (match === null || /\/\s*>\s*$/u.test(match[0])) return null;
  const tag = match[1]!.toLocaleLowerCase();
  return VOID_HTML_TAGS.has(tag) ? null : tag;
}

function htmlTagBalance(raw: string, tag: string): number {
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, "giu");
  let balance = 0;
  for (const match of raw.matchAll(pattern)) {
    if (match[1] === "/") balance -= 1;
    else if (!/\/\s*>$/u.test(match[0])) balance += 1;
  }
  return balance;
}

function childTokensContainMarkup(token: Token): boolean {
  for (const child of childTokens(token)) {
    if (child.type === "html" || child.type === "cwInlineMath" || child.type === "cwDisplayMath" || isMathCode(child) || childTokensContainMarkup(child)) return true;
  }
  return false;
}

function isMathCode(token: Token): boolean {
  return token.type === "code" && /^(?:math|latex|tex)$/iu.test(token.lang ?? "");
}

function prepareMarkupTokens(tokens: Token[]): void {
  for (const token of tokens) {
    if (isMathCode(token)) token.type = "cwDisplayMath";
    prepareMarkupTokens(childTokens(token));
    if (token.type === "list") {
      for (const item of token.items) prepareMarkupTokens(item.tokens);
    }
  }
}

function messageMarkupNode(tokens: Token[]): Html {
  prepareMarkupTokens(tokens);
  return {
    type: "html",
    value: tokens.map((token) => token.raw ?? "").join(""),
    data: { [MESSAGE_MARKUP_HTML]: marked.parser(tokens) },
  };
}

export function markedMessageMarkupSource(source: string): string | null {
  const tokens = marked.lexer(source);
  if (!tokensContainMarkup(tokens)) return null;
  prepareMarkupTokens(tokens);
  return marked.parser(tokens);
}

function tokensContainMarkup(tokens: Token[]): boolean {
  for (let index = 0; index < tokens.length; index += 1) {
    if (messageMarkupEndIndex(tokens, index) !== null) return true;
    const token = tokens[index]!;
    if (childTokensContainMarkup(token)) return true;
    if (token.type === "list" && token.items.some((item: Tokens.ListItem) => tokensContainMarkup(item.tokens))) return true;
  }
  return false;
}

export function messageMarkupNodeHtml(node: Html): string | null {
  const html = Reflect.get(node.data ?? {}, MESSAGE_MARKUP_HTML);
  return typeof html === "string" ? html : null;
}

type ExtractedFootnote = { identifier: string; body: string };

function extractFootnotes(source: string): { source: string; definitions: ExtractedFootnote[] } {
  const lines = source.split("\n");
  const definitions: ExtractedFootnote[] = [];
  const retained: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = /^ {0,3}\[\^([^\]]+)\]:[ \t]*(.*)$/u.exec(line);
    if (match === null) {
      retained.push(line);
      continue;
    }
    const body = [match[2]!];
    while (index + 1 < lines.length) {
      const next = lines[index + 1]!;
      if (/^(?: {2,}|\t)/u.test(next)) {
        body.push(next.replace(/^(?: {2,4}|\t)/u, ""));
        index += 1;
        continue;
      }
      if (next.trim() === "" && index + 2 < lines.length && /^(?: {2,}|\t)/u.test(lines[index + 2]!)) {
        body.push("");
        index += 1;
        continue;
      }
      break;
    }
    definitions.push({ identifier: match[1]!, body: body.join("\n") });
  }
  return { source: retained.join("\n"), definitions };
}

function footnoteDefinition(definition: ExtractedFootnote, context: ParseContext): FootnoteDefinition {
  const children = blockTokens(marked.lexer(definition.body), context).filter(
    (node): node is BlockContent => node.type !== "definition" && node.type !== "footnoteDefinition",
  );
  return {
    type: "footnoteDefinition",
    identifier: definition.identifier,
    label: definition.identifier,
    children,
  };
}

function listItem(token: Tokens.ListItem, context: ParseContext): ListItem {
  return {
    type: "listItem",
    spread: token.loose,
    ...(token.task ? { checked: token.checked ?? false } : {}),
    children: blockTokens(childTokens(token), context),
  };
}

function table(token: Tokens.Table, context: ParseContext): Table {
  const row = (cells: Tokens.TableCell[]): TableRow => ({
    type: "tableRow",
    children: cells.map((cell) => tableCell(cell, context)),
  });
  return {
    type: "table",
    align: token.align,
    children: [row(token.header), ...token.rows.map(row)],
  };
}

function tableCell(token: Tokens.TableCell, context: ParseContext): TableCell {
  return { type: "tableCell", children: inlineTokens(token.tokens, context) };
}

function inlineTokens(tokens: Token[], context: ParseContext): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "text":
        if (token.tokens !== undefined && token.tokens.length > 0) result.push(...inlineTokens(token.tokens, context));
        else result.push(...textNodes(token.text, context));
        break;
      case "escape":
        result.push({ type: "text", value: token.text });
        break;
      case "strong":
        result.push({ type: "strong", children: inlineTokens(childTokens(token), context) });
        break;
      case "em":
        result.push({ type: "emphasis", children: inlineTokens(childTokens(token), context) });
        break;
      case "del":
        result.push({ type: "delete", children: inlineTokens(childTokens(token), context) });
        break;
      case "codespan":
        result.push({ type: "inlineCode", value: token.text });
        break;
      case "br":
        result.push({ type: "break" });
        break;
      case "link": {
        const footnote = /^\[\^([^\]]+)\]$/u.exec(token.raw);
        if (footnote !== null) {
          result.push({ type: "footnoteReference", identifier: footnote[1]!, label: footnote[1]! });
        } else {
          result.push({
            type: "link",
            url: decodeText(token.href),
            title: token.title === undefined || token.title === null ? null : decodeText(token.title),
            children: inlineTokens(childTokens(token), context),
          });
        }
        break;
      }
      case "image":
        result.push({
          type: "image",
          url: decodeText(token.href),
          title: token.title === null ? null : decodeText(token.title),
          alt: decodeText(token.text),
        });
        break;
      case "html":
        result.push({ type: "html", value: token.text });
        break;
      case "checkbox":
        break;
      default: {
        const nested = "tokens" in token && Array.isArray(token.tokens) ? inlineTokens(token.tokens, context) : [];
        if (nested.length > 0) result.push(...nested);
        else {
          const fallback = tokenText(token);
          if (fallback !== "") result.push({ type: "text", value: fallback });
        }
      }
    }
  }
  return result;
}

function codeInfo(value: string | undefined): { lang: string | null; meta: string | null } {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return { lang: null, meta: null };
  const separator = trimmed.search(/\s/u);
  if (separator < 0) return { lang: decodeText(trimmed), meta: null };
  return {
    lang: decodeText(trimmed.slice(0, separator)),
    meta: decodeText(trimmed.slice(separator).trim()) || null,
  };
}

function decodeText(value: string): string {
  return value.replace(CHARACTER_REFERENCE, (match, reference: string) => (
    decodeNamedCharacterReference(reference) || match
  ));
}

function textNodes(value: string, context: ParseContext): PhrasingContent[] {
  const decoded = decodeText(value);
  const result: PhrasingContent[] = [];
  let cursor = 0;
  for (const match of decoded.matchAll(FOOTNOTE_REFERENCE)) {
    const identifier = match[1]!;
    if (!context.footnotes.has(identifier)) continue;
    const index = match.index;
    if (index > cursor) result.push({ type: "text", value: decoded.slice(cursor, index) });
    result.push({ type: "footnoteReference", identifier, label: identifier });
    cursor = index + match[0].length;
  }
  if (cursor < decoded.length) result.push({ type: "text", value: decoded.slice(cursor) });
  return result;
}

function clampHeadingDepth(value: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return Math.max(1, Math.min(6, value)) as 1 | 2 | 3 | 4 | 5 | 6;
}

function tokenText(token: Token): string {
  if ("text" in token && typeof token.text === "string") return decodeText(token.text);
  return "raw" in token && typeof token.raw === "string" ? decodeText(token.raw.trim()) : "";
}

function childTokens(token: Token): Token[] {
  return "tokens" in token && Array.isArray(token.tokens) ? token.tokens : [];
}
