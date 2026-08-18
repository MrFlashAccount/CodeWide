import { fileMediaKind, isHtmlFile, isKnownCodeOrTextFile, isMarkdownFile } from "@codewide/file-types";

export type DocumentPreviewKind = "markdown" | "text" | "html" | "image" | "download";

export type DocumentPreviewSurface = "sheet" | "fullscreen" | "image-viewer" | "download";

/** Pick the presentation primitive before IO starts, so an image tap never
 * flashes the generic document sheet while its private file is materialized. */
export function documentPreviewSurface(kind: DocumentPreviewKind): DocumentPreviewSurface {
  if (kind === "image") return "image-viewer";
  if (kind === "html" || kind === "markdown") return "fullscreen";
  if (kind === "download") return "download";
  return "sheet";
}

export type PreviewableDocumentTarget = {
  kind: DocumentPreviewKind;
  name: string;
  path: string;
  line?: number;
  column?: number;
};

export type RemoteDocumentLocation = {
  path: string;
  line?: number;
  column?: number;
};

export type MarkdownLineTarget = {
  segmentIndex: number;
  line: number;
};

/** Maps a source line to the bounded Markdown segment that renders it.
 * Segments normally preserve the source byte-for-byte. Very large fenced
 * blocks receive synthetic close/reopen fence lines, so match each segment's
 * original contribution instead of merely summing rendered line counts. */
export function markdownLineTarget(
  source: string,
  segments: readonly string[],
  requestedLine: number | undefined,
): MarkdownLineTarget | null {
  if (requestedLine === undefined || requestedLine < 1 || segments.length === 0) return null;
  const sourceLineCount = countNewlines(source) + 1;
  const line = Math.min(requestedLine, sourceLineCount);
  const targetOffset = sourceLineStartOffset(source, line);
  let sourceOffset = 0;

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex]!;
    const contribution = segmentSourceContribution(segment, source, sourceOffset);
    const contributionEnd = sourceOffset + contribution.length;
    const isLast = segmentIndex === segments.length - 1;
    if (targetOffset < contributionEnd || isLast) {
      const sourcePrefixLength = Math.max(0, Math.min(contribution.length, targetOffset - sourceOffset));
      return {
        segmentIndex,
        line: 1
          + countNewlines(segment.slice(0, contribution.renderedStart))
          + countNewlines(source.slice(sourceOffset, sourceOffset + sourcePrefixLength)),
      };
    }
    sourceOffset = contributionEnd;
  }
  return null;
}

export function previewableDocumentKind(name: string, path: string): DocumentPreviewKind | null {
  const candidates = [name, path].map((candidate) => parseTextDocumentLocation(candidate).path);
  if (candidates.some(isMarkdownFile)) return "markdown";
  if (candidates.some(isHtmlFile)) return "html";
  return null;
}

export function remoteFileKind(name: string, path: string): DocumentPreviewKind {
  const candidates = [name, path].map((candidate) => parseTextDocumentLocation(candidate).path);
  const document = previewableDocumentKind(candidates[0] ?? name, candidates[1] ?? path);
  if (document !== null) return document;
  if (candidates.some((candidate) => fileMediaKind(candidate) === "image")) return "image";
  if (candidates.some(isKnownCodeOrTextFile)) return "text";
  return "download";
}

export function isRemoteFileHref(value: string): boolean {
  const raw = value.trim();
  const sourceReference = parseTextDocumentLocation(raw).path !== raw;
  return raw !== ""
    && !raw.startsWith("#")
    && !raw.startsWith("//")
    && !raw.includes("\0")
    && (sourceReference || !/^[a-z][a-z\d+.-]*:/iu.test(raw));
}

/** Resolve a path emitted by Codex against the remote thread cwd. The
 * companion remains the security boundary: it realpaths the result and only
 * serves files inside configured roots (or exact files observed from the app
 * server). */
export function resolveRemoteDocumentPath(value: string, cwd: string): string | null {
  return resolveRemoteDocumentLocation(value, cwd)?.path ?? null;
}

export function resolveRemoteDocumentLocation(value: string, cwd: string): RemoteDocumentLocation | null {
  const raw = value.trim();
  if (!isRemoteFileHref(raw)) return null;
  const withoutFragment = raw.split("#", 1)[0] ?? "";
  const withoutQuery = withoutFragment.split("?", 1)[0] ?? "";
  if (withoutQuery === "") return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const base = cwd.startsWith("/") ? cwd : "/workspace";
  const normalized = normalizeAbsoluteRemotePath(decoded.startsWith("/") ? decoded : `${base}/${decoded}`);
  return parseTextDocumentLocation(normalized);
}

export function resolvePreviewableDocumentLink(href: string, cwd: string): PreviewableDocumentTarget | null {
  const location = resolveRemoteDocumentLocation(href, cwd);
  if (location === null) return null;
  const name = remoteDocumentBasename(location.path);
  return {
    kind: remoteFileKind(name, location.path),
    name,
    path: location.path,
    ...(location.line === undefined ? {} : { line: location.line }),
    ...(location.column === undefined ? {} : { column: location.column }),
  };
}

export function remoteDocumentDirectory(path: string): string {
  const normalized = normalizeAbsoluteRemotePath(path);
  const boundary = normalized.lastIndexOf("/");
  return boundary <= 0 ? "/" : normalized.slice(0, boundary);
}

function remoteDocumentBasename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "document";
}

function sourceLineStartOffset(source: string, line: number): number {
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const newline = source.indexOf("\n", offset);
    if (newline < 0) return source.length;
    offset = newline + 1;
  }
  return offset;
}

function segmentSourceContribution(segment: string, source: string, sourceOffset: number): { renderedStart: number; length: number } {
  const remaining = source.slice(sourceOffset);
  const candidateStarts = [0];
  let newline = segment.indexOf("\n");
  while (newline >= 0 && newline + 1 < Math.min(segment.length, 512)) {
    candidateStarts.push(newline + 1);
    newline = segment.indexOf("\n", newline + 1);
  }
  let best = { renderedStart: 0, length: 0 };
  for (const renderedStart of candidateStarts) {
    const length = commonPrefixLength(segment, renderedStart, remaining);
    if (length > best.length) best = { renderedStart, length };
  }
  return best;
}

function commonPrefixLength(segment: string, segmentStart: number, source: string): number {
  const limit = Math.min(segment.length - segmentStart, source.length);
  let length = 0;
  while (length < limit && segment.charCodeAt(segmentStart + length) === source.charCodeAt(length)) length += 1;
  return length;
}

function countNewlines(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

/** Codex renders source references as `/path/file.ts:line[:column]`. The
 * location is navigation metadata, not part of the remote filename. Strip it
 * only when the preceding path is a known text/code document so binary files
 * with numeric colon suffixes retain their literal path. */
function parseTextDocumentLocation(path: string): RemoteDocumentLocation {
  const match = /^(.*?):([1-9]\d*)(?::([1-9]\d*))?$/u.exec(path);
  if (match === null) return { path };
  const documentPath = match[1];
  if (documentPath === undefined || !isKnownCodeOrTextFile(documentPath)) return { path };
  const line = Number(match[2]);
  const column = match[3] === undefined ? undefined : Number(match[3]);
  return {
    path: documentPath,
    line,
    ...(column === undefined ? {} : { column }),
  };
}

function normalizeAbsoluteRemotePath(value: string): string {
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

/**
 * Repository HTML is untrusted content. Keep its visual HTML/CSS fidelity but
 * prevent scripts, network requests, forms and top-level navigation inside the
 * authenticated application WebView.
 */
export function isolatedHtmlDocument(source: string): string {
  const policy = "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const head = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{color-scheme:light dark}html{font-family:system-ui,sans-serif;line-height:1.45;padding:16px}body{margin:0;overflow-wrap:anywhere}img,video,svg,canvas{max-width:100%;height:auto}table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}pre{overflow:auto}a{color:#79a9ff}</style>`;
  const headTag = /<head(?:\s[^>]*)?>/iu;
  if (headTag.test(source)) return source.replace(headTag, (match) => `${match}${head}`);
  const htmlTag = /<html(?:\s[^>]*)?>/iu;
  if (htmlTag.test(source)) return source.replace(htmlTag, (match) => `${match}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${source}</body></html>`;
}
