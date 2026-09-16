import type { QueuedPrompt } from "../../data/thread-delivery-state";
import type { StoredDraftAttachment } from "../../data/thread-ui-state-types";
import type { InlineQueueOverlayItem } from "../queue/inlineQueueContract";
import { InlineQueueOverlay } from "../queue/InlineQueueOverlay";

export function ConversationQueueFooter({
  beginQueuedComposerEdit,
  closeInlineQueueOverlay,
  currentTurnId,
  inlineQueueExpanded,
  inlineQueueMaxHeight,
  inlineQueueOverlayItems,
  onCancelQueued,
  onEditQueued,
  onListQueue,
  onMoveQueued,
  onRetryFailedMessage,
  onSteerQueued,
  queuedPromptEditing,
  threadSearchActive,
  toggleInlineQueueOverlay,
  visibleQueuedPrompts,
  voicePhase,
}: {
  beginQueuedComposerEdit: (item: QueuedPrompt) => void;
  closeInlineQueueOverlay: () => void;
  currentTurnId: string | null;
  inlineQueueExpanded: boolean;
  inlineQueueMaxHeight: number;
  inlineQueueOverlayItems: InlineQueueOverlayItem[];
  onCancelQueued: ((commandId: string) => Promise<void>) | undefined;
  onEditQueued:
    | ((commandId: string, text: string, attachments: StoredDraftAttachment[]) => Promise<void>)
    | undefined;
  onListQueue: (() => Promise<QueuedPrompt[]>) | undefined;
  onMoveQueued: ((commandId: string, direction: -1 | 1) => Promise<void>) | undefined;
  onRetryFailedMessage: ((commandId: string) => Promise<void>) | undefined;
  onSteerQueued: ((commandId: string, expectedTurnId: string) => Promise<void>) | undefined;
  queuedPromptEditing: boolean;
  threadSearchActive: boolean;
  toggleInlineQueueOverlay: () => void;
  visibleQueuedPrompts: QueuedPrompt[];
  voicePhase: "idle" | "starting" | "recording" | "finishing";
}) {
  return !queuedPromptEditing && !threadSearchActive && inlineQueueOverlayItems.length > 0 ? (
    <InlineQueueOverlay
      activeTurnId={currentTurnId}
      expanded={inlineQueueExpanded}
      items={inlineQueueOverlayItems}
      maxHeight={inlineQueueMaxHeight}
      onClose={closeInlineQueueOverlay}
      onOpen={toggleInlineQueueOverlay}
      {...(onEditQueued === undefined || voicePhase !== "idle"
        ? {}
        : {
            onEdit: (itemId: string) => {
              const item = visibleQueuedPrompts.find((candidate) => candidate.commandId === itemId);
              if (item !== undefined) {
                beginQueuedComposerEdit(item);
              }
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
