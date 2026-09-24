import { userQuestionReplyText } from "./userQuestionReply";

type MentionedUserFile = {
  name: string;
  path: string;
};

export type NormalizedUserMessage = {
  files: MentionedUserFile[];
  text: string;
};

const REQUEST_HEADING = /^## My request for Codex:\s*$/m;
// The short heading is ordinary Markdown unless preceded by Desktop's complete browser envelope.
const DESKTOP_BROWSER_REQUEST =
  /^\s*<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>\s*## My request:[ \t]*(?:\r?\n|$)/;
const FILES_HEADING = /^# Files mentioned by the user:\s*$/m;
const AMBIENT_CONTEXT = /<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/gi;
const IMAGE_TAG = /<\/?image(?:\s[^>]*)?>/gi;
const FILE_ENTRY = /^##\s+(.+?):\s*(?:`([^`\n]+)`|([^\n]+))\s*$/gm;
const REALTIME_DELEGATION =
  /^\s*<realtime_delegation>\s*<input>([\s\S]*?)<\/input>\s*<transcript_delta>[\s\S]*?<\/transcript_delta>\s*<\/realtime_delegation>\s*$/;

/**
 * Codex appends transport-only context to the user input item. Keep that
 * envelope available to the agent, but project only the authored request in
 * the chat bubble. The exact headings are intentional: ordinary Markdown
 * which merely resembles metadata must remain visible.
 */
export function normalizeUserMessage(source: string): NormalizedUserMessage {
  const authoredSource = source.replace(REALTIME_DELEGATION, "$1");
  const reply = userQuestionReplyText(authoredSource);
  if (reply !== null) {
    return { files: [], text: reply };
  }
  const request =
    DESKTOP_BROWSER_REQUEST.exec(authoredSource) ?? REQUEST_HEADING.exec(authoredSource);
  const filesHeading = FILES_HEADING.exec(authoredSource);
  const metadataEnd = request?.index ?? authoredSource.length;
  const files =
    filesHeading !== null && filesHeading.index < metadataEnd
      ? parseMentionedFiles(authoredSource.slice(filesHeading.index, metadataEnd))
      : [];
  const authored =
    request === null ? authoredSource : authoredSource.slice(request.index + request[0].length);
  return {
    files,
    text: authored.replace(AMBIENT_CONTEXT, "").replace(IMAGE_TAG, "").trim(),
  };
}

function parseMentionedFiles(section: string): MentionedUserFile[] {
  const files: MentionedUserFile[] = [];
  for (const match of section.matchAll(FILE_ENTRY)) {
    const name = match[1]?.trim();
    const path = (match[2] ?? match[3])?.trim();
    if (name === undefined || name === "" || path === undefined || path === "") {
      continue;
    }
    files.push({ name, path });
  }
  return files;
}
