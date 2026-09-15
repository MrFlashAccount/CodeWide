import type { QueuedPrompt } from "../../data/thread-delivery-state";
import type { StoredDraftAttachment } from "../../data/thread-ui-state-types";
import type { InlineQueueOverlayItem } from "../queue/inlineQueueContract";
import { InlineQueueOverlay } from "../queue/InlineQueueOverlay";

export function ConversationQueueFooter({
  threadSearchActive,
  inlineQueueExpanded,
  queuedPromptEditing,
  inlineQueueOverlayItems,
  inlineQueueMaxHeight,
  currentTurnId,
  toggleInlineQueueOverlay,
  closeInlineQueueOverlay,
  onEditQueued,
  voicePhase,
  visibleQueuedPrompts,
  beginQueuedComposerEdit,
  onCancelQueued,
  onMoveQueued,
  onRetryFailedMessage,
  onSteerQueued,
  onListQueue,
}: {
  threadSearchActive: boolean;
  inlineQueueExpanded: boolean;
  queuedPromptEditing: boolean;
  inlineQueueOverlayItems: InlineQueueOverlayItem[];
  inlineQueueMaxHeight: number;
  currentTurnId: string | null;
  toggleInlineQueueOverlay: () => void;
  closeInlineQueueOverlay: () => void;
  onEditQueued:
    | ((commandId: string, text: string, attachments: StoredDraftAttachment[]) => Promise<void>)
    | undefined;
  voicePhase: "idle" | "starting" | "recording" | "finishing";
  visibleQueuedPrompts: QueuedPrompt[];
  beginQueuedComposerEdit: (item: QueuedPrompt) => void;
  onCancelQueued: ((commandId: string) => Promise<void>) | undefined;
  onMoveQueued: ((commandId: string, direction: -1 | 1) => Promise<void>) | undefined;
  onRetryFailedMessage: ((commandId: string) => Promise<void>) | undefined;
  onSteerQueued: ((commandId: string, expectedTurnId: string) => Promise<void>) | undefined;
  onListQueue: (() => Promise<QueuedPrompt[]>) | undefined;
}) {
  return !queuedPromptEditing && !threadSearchActive && inlineQueueOverlayItems.length > 0 ? (
    <InlineQueueOverlay
      maxHeight={inlineQueueMaxHeight}
      expanded={inlineQueueExpanded}
      items={inlineQueueOverlayItems}
      activeTurnId={currentTurnId}
      onOpen={toggleInlineQueueOverlay}
      onClose={closeInlineQueueOverlay}
      {...(onEditQueued === undefined || voicePhase !== "idle"
        ? {}
        : {
            onEdit: (itemId: string) => {
              const item = visibleQueuedPrompts.find((candidate) => candidate.commandId === itemId);
              if (item !== undefined) beginQueuedComposerEdit(item);
            },
          })}
      {...(onCancelQueued === undefined ? {} : { onCancel: onCancelQueued })}
      {...(onMoveQueued === undefined ? {} : { onMove: onMoveQueued })}
      {...(onRetryFailedMessage === undefined ? {} : { onRetry: onRetryFailedMessage })}
      {...(onSteerQueued === undefined ? {} : { onSteer: onSteerQueued })}
      {...(onListQueue === undefined ? {} : { onRefresh: onListQueue })}
    />
  ) : null;
}
