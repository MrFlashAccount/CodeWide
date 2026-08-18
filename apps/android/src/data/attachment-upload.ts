export const ATTACHMENT_ROOT_ID = "attachments";

const MAX_ATTACHMENT_FILENAME_CHARS = 180;
const MAX_THREAD_ID_CHARS = 160;

/**
 * Uploads selected by the Android system picker live in the companion's
 * private attachment root. The original basename remains visible to Codex,
 * while a unique prefix avoids overwrite prompts and duplicate-name races.
 */
export function attachmentUploadPath(
  threadId: string,
  originalName: string,
  now = Date.now(),
  nonce = Math.random().toString(36).slice(2, 10),
): string {
  const session = threadId.trim();
  if (
    session.length === 0
    || session.length > MAX_THREAD_ID_CHARS
    || !/^[a-zA-Z0-9_-]+$/u.test(session)
  ) {
    throw new Error("A valid thread ID is required before attaching files");
  }
  const sanitized = originalName
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "_")
    .trim()
    .slice(-MAX_ATTACHMENT_FILENAME_CHARS) || "attachment";
  const filename = `${Math.max(0, Math.floor(now)).toString(36)}-${nonce.replace(/[^a-z\d_-]/giu, "").slice(0, 16) || "file"}-${sanitized}`;
  return `sessions/${session}/files/${filename}`;
}
