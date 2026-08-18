import type { Nodes, Root } from "mdast";

import { markedMarkdownBlockIndexAtLine, markedMarkdownRoot } from "./marked-mdast";

export const MAX_MARKDOWN_SOURCE_CHARS = 512 * 1024;
export const MAX_MARKDOWN_CACHE_SOURCE_CHARS = 4 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 256;
const cache = new Map<string, ParsedRichMarkdown>();
let cachedSourceChars = 0;

export type ParsedRichMarkdown = {
  root: Root;
  truncated: boolean;
  originalLength: number;
};

export function parseRichMarkdown(source: string): ParsedRichMarkdown {
  const cacheable = source.length <= MAX_MARKDOWN_SOURCE_CHARS;
  const cached = cacheable ? cache.get(source) : undefined;
  if (cached !== undefined) {
    cache.delete(source);
    cache.set(source, cached);
    return cached;
  }
  const truncated = source.length > MAX_MARKDOWN_SOURCE_CHARS;
  const bounded = truncated ? `${source.slice(0, MAX_MARKDOWN_SOURCE_CHARS)}\n\n…` : source;
  const parsed = {
    root: markedMarkdownRoot(bounded),
    truncated,
    originalLength: source.length,
  };
  if (cacheable) {
    cache.set(source, parsed);
    cachedSourceChars += source.length;
    while (cache.size > MAX_CACHE_ENTRIES || cachedSourceChars > MAX_MARKDOWN_CACHE_SOURCE_CHARS) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
      cachedSourceChars = Math.max(0, cachedSourceChars - oldest.length);
    }
  }
  return parsed;
}

export function richMarkdownBlockIndexAtLine(source: string, line: number): number | null {
  return markedMarkdownBlockIndexAtLine(source, line);
}

export function plainRichMarkdownText(source: string): string {
  return plainRichMarkdownRootText(parseRichMarkdown(source).root);
}

export function plainRichMarkdownRootText(root: Nodes): string {
  return plainNodeText(root).replace(/\n{3,}/gu, "\n\n").trim();
}

function plainNodeText(node: Nodes): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "code":
    case "html":
    case "yaml":
      return node.value;
    case "image":
      return node.alt?.trim() || "Image";
    case "break":
    case "thematicBreak":
      return "\n";
    case "list":
      return node.children.map((item, index) => {
        const marker = node.ordered ? `${(node.start ?? 1) + index}. ` : "• ";
        return `${marker}${plainNodeText(item)}`;
      }).join("\n");
    case "root":
    case "blockquote":
    case "listItem":
      return node.children.map(plainNodeText).filter(Boolean).join("\n");
    case "paragraph":
    case "heading":
    case "strong":
    case "emphasis":
    case "delete":
    case "link":
    case "linkReference":
      return node.children.map(plainNodeText).join("");
    case "imageReference":
      return node.alt?.trim() || "Image";
    case "footnoteReference":
      return `[${node.identifier}]`;
    case "footnoteDefinition":
    case "definition":
      return "";
    case "table":
    case "tableRow":
      return node.children.map(plainNodeText).join("\n");
    case "tableCell":
      return node.children.map(plainNodeText).join("");
    default:
      return "";
  }
}

export function richMarkdownCacheStats(): { entries: number; sourceChars: number } {
  return { entries: cache.size, sourceChars: cachedSourceChars };
}

export function resetRichMarkdownCache(): void {
  cache.clear();
  cachedSourceChars = 0;
}

export function isSafeLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
