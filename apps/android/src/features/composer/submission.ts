import { composerUploads } from "../../data/composer-uploads";
import { remoteAttachment } from "../../data/quickdraw-attachment";
import type { SendMode } from "../../data/thread-delivery-state";
import { useEvent } from "../../react/useEvent";
import { resolveComposerSendMode, type ComposerSendPreference } from "./deliveryMode";
import { EMPTY_TURN_CONTROLS } from "./settings";
import {
  containsSkillInvocation,
  markdownForComposerSubmission,
} from "./skills/composer-skill-suggestions";
import type { ComposerSubmissionCapabilities } from "./submissionCapabilities";
import { mergeFailedComposerAttachments, mergeFailedComposerText } from "./submissionRecovery";
export function useComposerSubmission({
  composerScope,
  composerUploadScope,
  latestAttachmentsRef,
  latestDraftRef,
  latestComposerPreferencesRef,
  composerMarkdownRef,
  selectedModel,
  selectedEffort,
  selectedPersonality,
  selectedPermissions,
  capturePreferenceUpdate,
  captureControlsResource,
  queuedComposerEdit,
  pastedAttachmentPendingRef,
  captureDraftMutations,
  threadLifecycleActive,
  currentTurnId,
  contentReviewAttachmentId,
  clearContentReviewAttachmentId,
  conversationOwner,
  draftConnectionId,
  draftThreadId,
  onSend,
  onListQueue,
  saveDraft,
  saveDraftAttachments,
}: ComposerSubmissionCapabilities) {
  const captureSend = useEvent(() => {
    const { updateDraft, updateAttachments } = captureDraftMutations();
    const updateComposerPreferences = capturePreferenceUpdate();
    const currentControlsResource = captureControlsResource();
    const send = (textOverride?: string, preference: ComposerSendPreference = "start") => {
      if (
        queuedComposerEdit !== null ||
        pastedAttachmentPendingRef.current ||
        composerUploads.blocksSend(composerUploadScope)
      )
        return;
      // Voice completion passes its final draft explicitly. Reading `draft`
      // here would use the render captured when recording started and can send
      // the pre-transcription text instead of the latest transcript.
      const text = (
        textOverride ?? markdownForComposerSubmission(composerMarkdownRef.current)
      ).trim();
      const sentAttachments = composerUploads.readyAttachments(
        composerUploadScope,
        latestAttachmentsRef.current.latest,
      );
      if ((!text && sentAttachments.length === 0) || onSend === undefined) return;
      const scope = composerScope;
      const sentContentReviewAttachmentId = contentReviewAttachmentId;
      // Delivery mode is a one-shot command for this draft. Normal Send uses the
      // durable queue while a turn is active and starts immediately when idle;
      // opening the long-press menu must never mutate a persisted default.
      const mode: SendMode = resolveComposerSendMode(
        preference,
        threadLifecycleActive,
        currentTurnId,
      );
      const currentControls = currentControlsResource()?.value ?? EMPTY_TURN_CONTROLS;
      const selectedSkillPaths = latestComposerPreferencesRef.current.latest.skillPaths;
      const plainDraft = latestDraftRef.current.latest;
      const skills = currentControls.skills
        .filter(
          (skill) =>
            selectedSkillPaths.includes(skill.path) &&
            containsSkillInvocation(plainDraft, skill.name),
        )
        .map(({ name, path }) => ({ name, path }));
      const restoreSentSkillPaths = () => {
        if (selectedSkillPaths.length === 0) return;
        updateComposerPreferences((current) => {
          const missing = selectedSkillPaths.filter((path) => !current.skillPaths.includes(path));
          return missing.length === 0
            ? current
            : { ...current, skillPaths: [...current.skillPaths, ...missing] };
        });
      };
      const operation = onSend(text, mode, {
        ...(selectedModel === null ? {} : { model: selectedModel }),
        ...(selectedEffort === null ? {} : { effort: selectedEffort }),
        ...(selectedPersonality === null ? {} : { personality: selectedPersonality }),
        ...(selectedPermissions === null ? {} : { permissions: selectedPermissions }),
        ...(skills.length === 0 ? {} : { skills }),
        ...(sentAttachments.length === 0
          ? {}
          : { attachments: sentAttachments.map(remoteAttachment) }),
      });
      updateDraft("");
      updateAttachments([]);
      if (selectedSkillPaths.length > 0)
        updateComposerPreferences((current) => ({ ...current, skillPaths: [] }));
      for (const attachment of sentAttachments)
        composerUploads.remove(composerUploadScope, attachment.id);
      // Do not move or replace the resident history window here. The delivery is
      // already a row in the model-owned timeline. LegendList MVCP remains the
      // only position owner; calling loadLatest or scrollToEnd from Send can
      // replace the range underneath an already measured list.
      void operation
        .then(() => {
          if (sentContentReviewAttachmentId !== null)
            clearContentReviewAttachmentId(scope, sentContentReviewAttachmentId);
          if (mode.type === "queue" && onListQueue !== undefined) {
            void onListQueue().catch(() => undefined);
          }
        })
        .catch(() => {
          // Native persistence failed before Kotlin accepted ownership. Restore
          // the composer; successful submissions are rendered exclusively from
          // the Legend delivery/queue projection.
          if (conversationOwner.isCurrent()) {
            restoreSentSkillPaths();
            const recoveredDraft = mergeFailedComposerText(latestDraftRef.current.latest, text);
            if (recoveredDraft !== latestDraftRef.current.latest) updateDraft(recoveredDraft);
            const recoveredAttachments = mergeFailedComposerAttachments(
              latestAttachmentsRef.current.latest,
              sentAttachments,
            );
            if (recoveredAttachments !== latestAttachmentsRef.current.latest)
              updateAttachments(recoveredAttachments);
            return;
          }
          if (conversationOwner.hasReplacement()) return;
          // The user already navigated away. Restore the failed submission in its
          // owning thread without mutating the newly selected composer's local UI.
          const recoveredDraft = mergeFailedComposerText(latestDraftRef.current.latest, text);
          latestDraftRef.current.latest = recoveredDraft;
          restoreSentSkillPaths();
          if (saveDraft !== undefined && draftConnectionId !== null && draftThreadId !== null) {
            void saveDraft(draftConnectionId, draftThreadId, recoveredDraft).catch(() => undefined);
          }
          const recoveredAttachments = mergeFailedComposerAttachments(
            latestAttachmentsRef.current.latest,
            sentAttachments,
          );
          latestAttachmentsRef.current.latest = recoveredAttachments;
          if (
            saveDraftAttachments !== undefined &&
            draftConnectionId !== null &&
            draftThreadId !== null
          ) {
            void saveDraftAttachments(draftConnectionId, draftThreadId, recoveredAttachments).catch(
              () => undefined,
            );
          }
        });
    };
    return send;
  });
  const send = useEvent((textOverride?: string, preference: ComposerSendPreference = "start") =>
    captureSend()(textOverride, preference),
  );
  return { send, captureSend };
}

import type { ActionMenuItem } from "../../ui/ActionMenu";
import type { ComposerDeliveryCapabilities } from "./deliveryCapabilities";
export function useComposerDeliveryActions({
  queuedComposerEdit,
  queuedComposerEditBusy,
  voicePhase,
  finishVoice,
  send,
  currentTurnId,
  draft,
  attachments,
  onEditQueued,
  pastedAttachmentPending,
  uploadsBlockSend,
  voiceRetryAvailable,
  voiceError,
  cancelQueuedComposerEdit,
  discardVoice,
  clearComposerText,
  saveQueuedComposerEdit,
  onInterrupt,
  threadLifecycleActive,
}: ComposerDeliveryCapabilities) {
  const deliveryActions: ActionMenuItem[] = [
    { id: "start", label: "Send now", icon: "send-outline", disabled: threadLifecycleActive },
    {
      id: "queue",
      label: "Queue after current turn",
      icon: "time-outline",
      disabled: !threadLifecycleActive,
    },
    {
      id: "steer",
      label: "Steer active turn",
      icon: "navigate-outline",
      disabled: currentTurnId === null,
    },
  ];

  const handleDeliveryAction = useEvent((id: string) => {
    if (queuedComposerEdit !== null || (id !== "start" && id !== "queue" && id !== "steer")) return;
    if (voicePhase !== "idle") void finishVoice(true, id);
    else send(undefined, id);
  });

  const editingQueuedMessage = queuedComposerEdit !== null;

  const stoppingResponse =
    !editingQueuedMessage &&
    currentTurnId !== null &&
    voicePhase === "idle" &&
    draft.trim() === "" &&
    attachments.length === 0;

  const sendDisabled =
    voicePhase === "finishing" ||
    queuedComposerEditBusy ||
    (editingQueuedMessage && onEditQueued === undefined) ||
    pastedAttachmentPending ||
    uploadsBlockSend ||
    (voicePhase === "idle" && !stoppingResponse && draft.trim() === "" && attachments.length === 0);

  const composerDiscardEnabled =
    editingQueuedMessage ||
    voicePhase !== "idle" ||
    voiceRetryAvailable ||
    voiceError !== null ||
    draft !== "";

  const discardComposer = useEvent(() => {
    if (editingQueuedMessage) cancelQueuedComposerEdit();
    else if (voicePhase !== "idle" || voiceRetryAvailable || voiceError !== null)
      void discardVoice();
    else clearComposerText();
  });

  const activatePrimaryAction = useEvent(() => {
    if (editingQueuedMessage) void saveQueuedComposerEdit();
    else if (voicePhase !== "idle") void finishVoice(true);
    else if (
      currentTurnId !== null &&
      onInterrupt !== undefined &&
      draft.trim() === "" &&
      attachments.length === 0
    )
      void onInterrupt(currentTurnId);
    else send();
  });

  const steerComposer = useEvent(() => {
    if (editingQueuedMessage || sendDisabled || currentTurnId === null || !threadLifecycleActive)
      return;
    handleDeliveryAction("steer");
  });
  return {
    deliveryActions,
    handleDeliveryAction,
    editingQueuedMessage,
    stoppingResponse,
    sendDisabled,
    composerDiscardEnabled,
    discardComposer,
    activatePrimaryAction,
    steerComposer,
  };
}
