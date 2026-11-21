import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { VoiceInputController } from "../../data/voice-input-controller";
import {
  useContentReviewRuntime,
  type ContentReviewRuntime,
} from "../../rendering/ContentReviewHost";
import type { AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";

/** Bind the mounted conversation's review session without owning the shared selection host. */
export function useReviewFeature({
  appVoiceInputRuntime,
  attachContentReview,
  composerScope,
  contentReviewAttachmentId,
  onStartVoiceTranscription,
  remoteThread,
  removeContentReviewAttachment,
  voiceController,
}: {
  readonly appVoiceInputRuntime: AppVoiceInputRuntime;
  readonly attachContentReview: ContentReviewRuntime["attach"];
  readonly composerScope: string;
  readonly contentReviewAttachmentId: string | null;
  readonly onStartVoiceTranscription: ContentReviewRuntime["startVoice"];
  readonly remoteThread: Thread | null | undefined;
  readonly removeContentReviewAttachment?: ContentReviewRuntime["removeAttachment"];
  readonly voiceController: VoiceInputController | null;
}): void {
  useContentReviewRuntime({
    attach: attachContentReview,
    attachmentId: contentReviewAttachmentId,
    ...(removeContentReviewAttachment === undefined
      ? {}
      : { removeAttachment: removeContentReviewAttachment }),
    resources: appVoiceInputRuntime.resources,
    thread: remoteThread ?? null,
    voiceController,
    voiceScope: `${composerScope}\u0000review`,
    ...(onStartVoiceTranscription === undefined ? {} : { startVoice: onStartVoiceTranscription }),
  });
}
