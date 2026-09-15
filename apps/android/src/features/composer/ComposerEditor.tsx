import { MAX_TURN_ATTACHMENTS } from "@codewide/sync-client";
import { PrivateImageAccessProvider } from "../../rendering/use-private-image-uri";
import { AUTO_ATTACH_PASTE_MIN_CHARS } from "./attachments/largePasteCapture";
import { styles } from "./ComposerEditor.styles";
import type { ComposerFeatureProps } from "./ComposerFeatureContract";
import { ComposerMarkdownInput } from "./input/ComposerMarkdownInput";
import { VoiceCaptureStatus } from "./voice/VoiceCaptureStatus";

type Props = Pick<
  ComposerFeatureProps,
  | "voicePhase"
  | "composerScope"
  | "getTransferAccess"
  | "getStableTransferAccess"
  | "composerInputRef"
  | "fileAttachmentEnabled"
  | "pastedAttachmentPending"
  | "attachments"
  | "handleComposerLargePaste"
  | "draft"
  | "handleComposerTextChange"
  | "handleComposerMarkdownChange"
  | "draftSelectionRef"
  | "pendingVoiceSelection"
  | "voiceController"
  | "searchComposerSuggestions"
  | "selectComposerMention"
  | "editingQueuedMessage"
  | "voiceBackend"
  | "voiceResource"
>;
export function ComposerEditor({
  voicePhase,
  composerScope,
  getTransferAccess,
  getStableTransferAccess,
  composerInputRef,
  fileAttachmentEnabled,
  pastedAttachmentPending,
  attachments,
  handleComposerLargePaste,
  draft,
  handleComposerTextChange,
  handleComposerMarkdownChange,
  draftSelectionRef,
  pendingVoiceSelection,
  voiceController,
  searchComposerSuggestions,
  selectComposerMention,
  editingQueuedMessage,
  voiceBackend,
  voiceResource,
}: Props) {
  return voicePhase === "idle" || voicePhase === "starting" ? (
    <PrivateImageAccessProvider
      scope={`${composerScope}:skill-suggestions`}
      {...(getTransferAccess === undefined ? {} : { getAccess: getStableTransferAccess })}
    >
      <ComposerMarkdownInput
        ref={composerInputRef}
        accessibilityLabel="Message Codex"
        {...(fileAttachmentEnabled &&
        !pastedAttachmentPending &&
        attachments.length < MAX_TURN_ATTACHMENTS
          ? {
              largePasteThreshold: AUTO_ATTACH_PASTE_MIN_CHARS,
              onLargePaste: handleComposerLargePaste,
            }
          : {})}
        value={draft}
        onChangeText={handleComposerTextChange}
        onChangeMarkdown={handleComposerMarkdownChange}
        onSelectionChange={(selection) => {
          draftSelectionRef.current = selection;
          if (
            pendingVoiceSelection !== null &&
            pendingVoiceSelection.start === selection.start &&
            pendingVoiceSelection.end === selection.end
          )
            voiceController?.clearPendingSelection(composerScope);
        }}
        {...(pendingVoiceSelection === null ? {} : { selection: pendingVoiceSelection })}
        mentionIndicators={["/"]}
        search={searchComposerSuggestions}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess: getStableTransferAccess })}
        onSelectMention={selectComposerMention}
        placeholder={editingQueuedMessage ? "Edit queued message…" : "Message Codex…"}
        style={styles.composerInput}
      />
    </PrivateImageAccessProvider>
  ) : (
    <VoiceCaptureStatus
      phase={voicePhase}
      backend={voiceBackend}
      startedAt={voiceResource?.updatedAt ?? 0}
      controller={voiceController}
      scope={composerScope}
    />
  );
}
