/** V1 AttachmentsFeature owner, extracted without changing interaction or resource lifetime. */
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { GetTransferAccess } from "../../data/private-transfer";
import type { ThreadChangeDiffValue } from "../../data/thread-resource-types";
import type { ThreadResourcesModel } from "../../data/thread-resources-model";
import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/workspace-resource-database";
import type { CodeReviewComment } from "../../rendering/code-review";
import type { AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";

/** Complete display and action contract for the thread attachment sheet. */
export type AttachmentSheetProps = {
  visible: boolean;
  codePreviewMaxHeight: number;
  model: ThreadResourcesModel | null;
  resourceId: string | null;
  revision: string;
  cwd: string;
  thread: Thread | null;
  voiceRuntime: AppVoiceInputRuntime | null;
  getTransferAccess: GetTransferAccess;
  onLoadThreadChangeDiff?(path: string, scope?: ThreadChangeScope): Promise<ThreadChangeDiffValue>;
  onAttachReview(comments: readonly CodeReviewComment[]): Promise<boolean>;
  onReload?(): Promise<ThreadResourcesValue>;
  onClose(): void;
};
