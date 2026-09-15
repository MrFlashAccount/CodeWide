import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
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
    thread: remoteThread ?? null,
    voiceScope: `${composerScope}\u0000review`,
    resources: appVoiceInputRuntime.resources,
    voiceController,
    ...(onStartVoiceTranscription === undefined ? {} : { startVoice: onStartVoiceTranscription }),
  });
}
