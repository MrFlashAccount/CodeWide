import { DomUtils, parseDocument } from "htmlparser2";
import { markedMessageMarkupSource, messageMarkupNodeHtml } from "./marked-mdast";

function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

/** Returns HTML for the native renderer, or null to retain the ordinary Markdown fast path.
 * The renderer owns HTML parsing and presentation filtering; this is not executable HTML.
 */
export function parseMessageMarkup(source: string): string | null {
  if (!/<[a-z!]|\$|\\[([]|```(?:math|latex|tex)/iu.test(source)) return null;
  return markedMessageMarkupSource(source);
}

export { messageMarkupNodeHtml };

/** Highlights visible text nodes only; never rewrites URLs, attributes or HTML syntax. */
export function highlightMessageMarkup(html: string, query: string): string {
  const tokens = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return html;
  const document = parseDocument(html);
  // This is a mutable traversal stack, separate from the DOM's owned children.
  const pending = [...document.children];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (node.type === "text") {
      if (!tokens.some(token => node.data.toLocaleLowerCase().includes(token))) continue;
      const body = node.data.split(/(\s+)/u).map(part => tokens.some(token => part.toLocaleLowerCase().includes(token)) ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)).join("");
      const replacement = parseDocument(`<span>${body}</span>`).children[0];
      if (replacement !== undefined) DomUtils.replaceElement(node, replacement);
    } else if ("children" in node && node.type !== "script" && node.type !== "style") {
      pending.push(...node.children);
    }
  }
  return DomUtils.getOuterHTML(document);
}
