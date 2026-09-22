import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { VoiceInputController } from "../../data/voice-input-controller";
import {
  useContentReviewRuntime,
  type ContentReviewRuntime,
} from "../../rendering/ContentReviewHost";
import type { AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";

/** Bind the mounted conversation's review session without owning the shared selection host. */
export function useReviewFeature(
  composerScope: string,
  contentReviewAttachmentId: string | null,
  remoteThread: Thread | null | undefined,
  appVoiceInputRuntime: AppVoiceInputRuntime,
  voiceController: VoiceInputController | null,
  onStartVoiceTranscription: ContentReviewRuntime["startVoice"],
  attachContentReview: ContentReviewRuntime["attach"],
) {
  useContentReviewRuntime({
    attach: attachContentReview,
    attachmentId: contentReviewAttachmentId,
    resources: appVoiceInputRuntime.resources,
    thread: remoteThread ?? null,
    voiceController,
    voiceScope: `${composerScope}\u0000review`,
    ...(onStartVoiceTranscription === undefined ? {} : { startVoice: onStartVoiceTranscription }),
  });
}
