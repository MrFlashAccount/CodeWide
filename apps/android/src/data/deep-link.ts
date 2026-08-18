export type ThreadDeepLink = { connectionId: string; threadId: string };

export function parseThreadDeepLink(raw: string): ThreadDeepLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if ((url.protocol !== "codewide:" && url.protocol !== "codexremote:") || url.hostname !== "thread") return null;
  const connectionId = url.searchParams.get("connectionId");
  const threadId = url.searchParams.get("threadId");
  if (!validId(connectionId) || !validId(threadId)) return null;
  return { connectionId, threadId };
}

function validId(value: string | null): value is string {
  return value !== null && value.length >= 1 && value.length <= 512 && !value.includes("\0");
}
