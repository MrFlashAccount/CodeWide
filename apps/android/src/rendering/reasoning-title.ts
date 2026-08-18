const MARKDOWN_PREFIX = /^(?:#{1,6}|[-+*>]|\d+[.)])\s+/u;
const MARKDOWN_EDGE = /^(?:[`*_~]+)|(?:[`*_~]+)$/gu;

export function reasoningActivityTitle(body: string | null, status: string | null): string {
  if (status !== "inProgress" && status !== "running") return "Thinking";
  const lines = body?.split(/\r?\n/u) ?? [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const raw = lines[index]?.trim() ?? "";
    if (raw === "" || /^```/u.test(raw)) continue;
    const title = raw.replace(MARKDOWN_PREFIX, "").replace(MARKDOWN_EDGE, "").trim();
    if (title !== "") return title;
  }
  return "Thinking";
}
