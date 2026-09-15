import type { RemoteFileAttachment } from "@codewide/sync-client";
import { toByteArray } from "base64-js";
import { randomUUID } from "expo-crypto";
import { checkAborted } from "../../../native/check-aborted";

import { ATTACHMENT_ROOT_ID, attachmentUploadPath } from "../../../data/attachment-upload";
import {
  createBinaryUpload,
  createTextUpload,
  startUpload,
  type SelectedUpload,
} from "../../../native/file-transfer";
import { browserFeedbackMarkdown, type BrowserFeedbackSubmission } from "./feedback";
import type { FeedbackDelivery, FeedbackTarget } from "./feedbackDelivery";

/** Uploads through inner TLS and uses the same durable queue as the composer. */
export async function sendBrowserFeedback(
  remote: FeedbackDelivery,
  target: FeedbackTarget,
  submission: BrowserFeedbackSubmission,
  signal: AbortSignal,
): Promise<void> {
  const uploads: SelectedUpload[] = [];
  const attachments: RemoteFileAttachment[] = [];
  try {
    checkAborted(signal);
    uploads.push(
      createTextUpload("browser-feedback.md", "text/markdown", browserFeedbackMarkdown(submission)),
    );
    if (submission.screenshot !== null)
      uploads.push(
        createBinaryUpload("browser-element.png", "image/png", toByteArray(submission.screenshot)),
      );
    for (const upload of uploads) {
      const path = attachmentUploadPath(target.threadId, upload.name);
      checkAborted(signal);
      const transfer = startUpload(
        () => remote.transferAccess(target.connectionId),
        upload,
        ATTACHMENT_ROOT_ID,
        path,
        false,
        ignoreProgress,
      );
      signal.addEventListener("abort", transfer.cancel, { once: true });
      try {
        await transfer.promise;
      } finally {
        signal.removeEventListener("abort", transfer.cancel);
      }
      attachments.push({
        id: randomUUID(),
        rootId: ATTACHMENT_ROOT_ID,
        path,
        name: upload.name,
        kind: upload.mimeType === "image/png" ? "image" : "file",
      });
    }
    checkAborted(signal);
    await remote.sendText(
      target.connectionId,
      target.threadId,
      submission.prompt,
      { type: "queue" },
      { attachments },
    );
  } finally {
    // These cache files were created by this send attempt, never selected user files.
    for (const upload of uploads) {
      try {
        if (upload.native.exists) upload.native.delete();
      } catch {
        /* A cache cleanup failure must not turn accepted delivery into a retry. */
      }
    }
  }
}

function ignoreProgress(): void {}
