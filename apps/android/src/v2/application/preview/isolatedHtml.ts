const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "style-src 'unsafe-inline'",
  "script-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const VIEWPORT = "width=device-width, initial-scale=1";
const DOCUMENT_STYLE =
  ":root{color-scheme:light dark}html{font-family:system-ui,sans-serif;line-height:1.45;padding:16px}body{margin:0;overflow-wrap:anywhere}img,video,svg,canvas{max-width:100%;height:auto}table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}pre{overflow:auto}a{color:#79a9ff}";

/** Keeps untrusted repository HTML visually useful while denying scripts,
 * requests, forms, nested browsing contexts, and authenticated navigation. */
export function isolatedPreviewHtml(source: string): string {
  const head = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}"><meta name="viewport" content="${VIEWPORT}"><style>${DOCUMENT_STYLE}</style>`;
  const headTag = /<head(?:\s[^>]*)?>/iu;
  if (headTag.test(source)) return source.replace(headTag, (match) => `${match}${head}`);
  const htmlTag = /<html(?:\s[^>]*)?>/iu;
  if (htmlTag.test(source))
    return source.replace(htmlTag, (match) => `${match}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${source}</body></html>`;
}
