import { MAX_TURN_ATTACHMENTS } from "@codewide/sync-client";
import { randomUUID } from "expo-crypto";

import { ATTACHMENT_ROOT_ID, attachmentUploadPath } from "../data/attachment-upload";
import type { PullRequestFile, ReviewChatOpening } from "../data/forgeMutationContract";
import { createTextUpload, startUpload } from "../native/file-transfer";
import type { HeadRevision, PullRequestKey } from "../data/forgeContract";
import type { PullRequestFileContent } from "../data/forgeFileContentContract";
import { forgeResources } from "../data/forgeRuntime";
import { workspaceFeatures } from "../features/workspace/createWorkspaceFeatures";
import { reviewChatDraftId } from "./reviewChatDraft";

/** Stages the selected file at the reviewed revision before opening the PR-owned composer. */
export async function attachReviewFile(
  target: { readonly connectionId: string; readonly pullRequest: PullRequestKey },
  file: PullRequestFile,
  revision: HeadRevision,
): Promise<ReviewChatOpening> {
  const { connectionId, pullRequest } = target;
  const { composer, pullRequestDetail } = workspaceFeatures;
  const opening = await pullRequestDetail.ensureReviewChat(
    { connectionId, pullRequest },
    { kind: "ask" },
  );
  const scope = opening.kind === "ready" ? opening.threadId : reviewChatDraftId(pullRequest);
  const attachments = await composer.loadDraftAttachments(connectionId, scope);
  if (attachments.length >= MAX_TURN_ATTACHMENTS) {
    throw new Error("The message already has the maximum number of attachments");
  }
  const content =
    file.status === "removed"
      ? null
      : await forgeResources.fileContent.preload({
          connectionId,
          headRevision: revision,
          path: file.path,
          pullRequest,
        });
  const upload = selectFileUpload(file, content);
  const path = attachmentUploadPath(scope, upload.name);
  await startUpload(
    async (refresh = false) => pullRequestDetail.transferAccess(connectionId, refresh),
    upload,
    ATTACHMENT_ROOT_ID,
    path,
    false,
    () => undefined,
  ).promise;
  await composer.upsertDraftAttachment(
    connectionId,
    scope,
    { id: randomUUID(), kind: "file", name: upload.name, path, rootId: ATTACHMENT_ROOT_ID },
    () => true,
  );
  return opening;
}

function selectFileUpload(
  file: PullRequestFile,
  content: PullRequestFileContent | null,
): ReturnType<typeof createTextUpload> {
  const name = file.path.split("/").at(-1) ?? file.path;
  const patch = file.patch;
  const upload =
    content?.state === "text"
      ? createTextUpload(name, "text/plain", content.content)
      : patch.state === "present"
        ? createTextUpload(
            name + ".patch",
            "text/x-diff",
            "diff --git a/" + file.path + " b/" + file.path + "\n" + patch.text,
          )
        : null;
  if (upload === null) {
    throw new Error(
      "No text or recorded patch is available for this file at the reviewed revision",
    );
  }
  return upload;
}
