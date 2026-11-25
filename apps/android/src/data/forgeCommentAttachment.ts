import type { PullRequestKey } from "./forgeContract";
import { fetchForgeAttachmentUpload, type GetTransferAccess } from "./private-transfer";
import { unknownRecord } from "./unknownRecord";

/** The selected Android document. Its bytes stay on device until Send. */
export type CommentAttachment = {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly uri: string;
};
/** The forge plugin protocol bounds each upload frame. */
export const MAX_COMMENT_ATTACHMENT_BYTES = 10_485_760;

/** Uploads one document into the PR's forge and returns its shareable HTTPS URL. */
export async function uploadCommentAttachment(
  pr: PullRequestKey,
  file: CommentAttachment,
  access: GetTransferAccess,
): Promise<string> {
  const response = await fetchForgeAttachmentUpload({ name: file.name, pullRequest: pr }, access, {
    body: { kind: "file", length: file.size, offset: 0, uri: file.uri },
    headers: { "content-type": file.type },
    method: "POST",
  });
  const body = unknownRecord(await response.json());
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string" ? body.error : "The forge could not attach this file.",
    );
  }
  if (typeof body?.url !== "string" || !body.url.startsWith("https://")) {
    throw new Error("The forge returned an invalid attachment URL.");
  }
  return body.url;
}
