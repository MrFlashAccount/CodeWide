/** V1 composerTypes owner, extracted without changing interaction or resource lifetime. */
import type { StoredDraftAttachment } from "../../data/thread-ui-state-types";

export type ComposerMenuPage =
  | "model"
  | "skills"
  | "permissions"
  | "queue"
  | "goal"
  | "review"
  | "runtime"
  | "ports";

export type QueuedComposerEdit = {
  readonly commandId: string;
  readonly initialAttachments: StoredDraftAttachment[];
  readonly initialText: string;
};

export type ComposerAccessoryAction = "files" | "drawing" | "skills" | "goal" | "terminal";
