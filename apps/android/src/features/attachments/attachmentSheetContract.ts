/** V1 AttachmentsFeature owner, extracted without changing interaction or resource lifetime. */
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { GetTransferAccess } from "../../data/private-transfer";
import type { ThreadChangeDiffValue } from "../../data/thread-resource-types";
import type { ThreadResourcesModel } from "../../data/thread-resources-model";
import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/workspace-resource-database";
import type { CodeReviewComment } from "../review/comments/reviewComment";
import type { AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";

/** Complete display and action contract for the thread attachment sheet. */
export type AttachmentSheetProps = {
  codePreviewMaxHeight: number;
  cwd: string;
  getTransferAccess: GetTransferAccess;
  model: ThreadResourcesModel | null;
  onAttachReview: (comments: readonly CodeReviewComment[]) => Promise<boolean>;
  onClose: () => void;
  onLoadThreadChangeDiff?: (
    path: string,
    scope?: ThreadChangeScope,
  ) => Promise<ThreadChangeDiffValue>;
  onReload?: () => Promise<ThreadResourcesValue>;
  resourceId: string | null;
  revision: string;
  thread: Thread | null;
  visible: boolean;
  voiceRuntime: AppVoiceInputRuntime | null;
};
