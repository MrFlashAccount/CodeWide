interface NormalizedUserFile {
  name: string;
  path: string;
}

export interface NormalizedUserMessage {
  files: NormalizedUserFile[];
  text: string;
}

const REQUEST_HEADING = /^## My request for Codex:\s*$/m;
const FILES_HEADING = /^# Files mentioned by the user:\s*$/m;
const AMBIENT_CONTEXT = /<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/giu;
const IMAGE_TAG = /<\/?image(?:\s[^>]*)?>/giu;
const FILE_ENTRY = /^##\s+(.+?):\s*(?:`([^`\n]+)`|([^\n]+))\s*$/gmu;

/**
 * Removes transport-owned Codex context from one authoritative user text block.
 * File metadata remains attached to this block so the display adapter can place
 * the resulting file entries without reordering the surrounding source blocks.
 */
export function normalizeUserMessage(source: string): NormalizedUserMessage {
  const request = REQUEST_HEADING.exec(source);
  const filesHeading = FILES_HEADING.exec(source);
  const metadataEnd = request?.index ?? source.length;
  const files =
    filesHeading !== null && filesHeading.index < metadataEnd
      ? mentionedFiles(source.slice(filesHeading.index, metadataEnd))
      : [];
  const authored = request === null ? source : source.slice(request.index + request[0].length);
  return {
    files,
    text: authored.replace(AMBIENT_CONTEXT, "").replace(IMAGE_TAG, "").trim(),
  };
}

function mentionedFiles(section: string): NormalizedUserFile[] {
  const files: NormalizedUserFile[] = [];
  for (const match of section.matchAll(FILE_ENTRY)) {
    const name = match[1]?.trim();
    const path = (match[2] ?? match[3])?.trim();
    if (name === undefined || name === "" || path === undefined || path === "") continue;
    files.push({ name, path });
  }
  return files;
}
