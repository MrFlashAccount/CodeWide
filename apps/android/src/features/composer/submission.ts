import { composerUploads } from "../../data/composer-uploads";
import { remoteAttachment } from "../../data/quickdraw-attachment";
import type { SendMode } from "../../data/thread-delivery-state";
import { useEvent } from "../../react/useEvent";
import { useAppDialog } from "../../ui/AppDialog";
import { useConversationState } from "../../ui/use-conversation-scope";
import { resolveComposerSendMode, type ComposerSendPreference } from "./deliveryMode";
import { EMPTY_TURN_CONTROLS } from "./settings";
import { containsSkillInvocation } from "./skills/composer-skill-suggestions";
import type { ComposerSubmissionCapabilities } from "./submissionCapabilities";
import { mergeFailedComposerAttachments, mergeFailedComposerText } from "./submissionRecovery";
import { composerTextForSubmission } from "./composerSubmissionText";
import { sameComposerAttachments, sameComposerPreferences } from "./composerSession";

type InterruptRequest =
  | { readonly status: "idle" }
  | { readonly status: "requested"; readonly turnId: string };

const IDLE_INTERRUPT_REQUEST: InterruptRequest = { status: "idle" };

export function useComposerSubmission({
  captureControlsResource,
  captureDraftMutations,
  capturePreferenceUpdate,
  clearContentReviewAttachmentId,
  composerInputRef,
  composerScope,
  composerSession,
  composerUploadScope,
  contentReviewAttachmentId,
  conversationOwner,
  currentTurnId,
  draftConnectionId,
  draftThreadId,
  goalSubmission,
  onListQueue,
  onSend,
  pastedAttachmentPendingRef,
  queuedComposerEdit,
  saveDraft,
  saveDraftAttachments,
  selectedEffort,
  selectedModel,
  selectedPermissions,
  selectedPersonality,
  selectedServiceTier,
  threadLifecycleActive,
}: ComposerSubmissionCapabilities) {
  const captureSend = useEvent(() => {
    const session = composerSession.capture();
    const capturedSession = session.read();
    const { updateAttachments, updateDraft } = captureDraftMutations();
    const updateComposerPreferences = capturePreferenceUpdate();
    const currentControlsResource = captureControlsResource();
    const submissionBlocked =
      queuedComposerEdit !== null ||
      pastedAttachmentPendingRef.current ||
      composerUploads.blocksSend(composerUploadScope);
    const capturedMarkdown = capturedSession.markdown;
    const capturedPlainDraft = capturedSession.plainText;
    // Voice resolution is delayed, so this Send activation owns one stable
    // attachment list even if the visible composer changes in the meantime.
    const sentAttachments = composerUploads
      .readyAttachments(composerUploadScope, capturedSession.attachments)
      .slice();
    const currentControls = currentControlsResource()?.value ?? EMPTY_TURN_CONTROLS;
    const selectedSkillPaths = capturedSession.preferences.skillPaths;
    const send = (textOverride?: string, preference: ComposerSendPreference = "start") => {
      if (submissionBlocked) {
        return;
      }
      // Voice completion supplies the merged final text, while attachments,
      // controls and preferences stay fixed to the user's Send activation.
      const submissionDraft = textOverride ?? capturedPlainDraft;
      const text = (
        textOverride ??
        composerTextForSubmission({ markdown: capturedMarkdown, plainText: capturedPlainDraft })
      ).trim();
      if (goalSubmission === null) {
        if ((text === "" && sentAttachments.length === 0) || onSend === undefined) {
          return;
        }
      } else if (text === "") {
        return;
      }
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
      const skills = currentControls.skills
        .filter(
          (skill) =>
            selectedSkillPaths.includes(skill.path) &&
            containsSkillInvocation(submissionDraft, skill.name),
        )
        .map(({ name, path }) => ({ name, path }));
      const restoreSentSkillPaths = () => {
        if (selectedSkillPaths.length === 0) {
          return;
        }
        updateComposerPreferences((current) => {
          const missing = selectedSkillPaths.filter((path) => !current.skillPaths.includes(path));
          return missing.length === 0
            ? current
            : { ...current, skillPaths: [...current.skillPaths, ...missing] };
        });
      };
      let operation: Promise<unknown>;
      if (goalSubmission === null) {
        if (onSend === undefined) {
          return;
        }
        operation = onSend(text, mode, {
          ...(selectedModel === null ? {} : { model: selectedModel }),
          ...(selectedServiceTier === undefined ? {} : { serviceTier: selectedServiceTier }),
          ...(selectedEffort === null ? {} : { effort: selectedEffort }),
          ...(selectedPersonality === null ? {} : { personality: selectedPersonality }),
          ...(selectedPermissions === null ? {} : { permissions: selectedPermissions }),
          ...(skills.length === 0 ? {} : { skills }),
          ...(sentAttachments.length === 0
            ? {}
            : { attachments: sentAttachments.map(remoteAttachment) }),
        });
      } else {
        operation = goalSubmission.submit(text);
      }
      const currentSession = session.read();
      const ownsText =
        (currentSession.markdown === capturedSession.markdown &&
          currentSession.plainText === capturedSession.plainText) ||
        (textOverride !== undefined && composerTextForSubmission(currentSession).trim() === text);
      if (ownsText) {
        updateDraft("");
      }
      if (goalSubmission === null) {
        if (sameComposerAttachments(currentSession.attachments, capturedSession.attachments)) {
          updateAttachments([]);
        }
        if (
          selectedSkillPaths.length > 0 &&
          sameComposerPreferences(currentSession.preferences, capturedSession.preferences)
        ) {
          updateComposerPreferences((current) => ({ ...current, skillPaths: [] }));
        }
        for (const attachment of sentAttachments) {
          composerUploads.remove(composerUploadScope, attachment.id);
        }
      }
      // Do not move or replace the resident history window here. The delivery is
      // already a row in the model-owned timeline. LegendList MVCP remains the
      // only position owner; calling loadLatest or scrollToEnd from Send can
      // replace the range underneath an already measured list.
      void operation
        .then(() => {
          if (goalSubmission !== null) {
            goalSubmission.close();
          } else if (sentContentReviewAttachmentId !== null) {
            clearContentReviewAttachmentId(scope, sentContentReviewAttachmentId);
          }
          if (goalSubmission === null && mode.type === "queue" && onListQueue !== undefined) {
            void onListQueue().catch(() => undefined);
          }
        })
        .catch(() => {
          // Native persistence failed before Kotlin accepted ownership. Restore
          // the composer; successful submissions are rendered exclusively from
          // the Legend delivery/queue projection.
          if (conversationOwner.isCurrent()) {
            restoreSentSkillPaths();
            const current = session.read();
            const recoveredDraft = mergeFailedComposerText(current.plainText, text);
            if (recoveredDraft !== current.plainText) {
              updateDraft(recoveredDraft);
            }
            const recoveredAttachments = mergeFailedComposerAttachments(
              current.attachments,
              sentAttachments,
            );
            if (recoveredAttachments !== current.attachments) {
              updateAttachments(recoveredAttachments);
            }
            return;
          }
          if (conversationOwner.hasReplacement()) {
            return;
          }
          // The user already navigated away. Restore the failed submission in its
          // owning thread without mutating the newly selected composer's local UI.
          const current = session.read();
          const recoveredDraft = mergeFailedComposerText(current.plainText, text);
          session.updateText({ markdown: recoveredDraft, plainText: recoveredDraft });
          restoreSentSkillPaths();
          if (saveDraft !== undefined && draftConnectionId !== null && draftThreadId !== null) {
            void saveDraft(draftConnectionId, draftThreadId, recoveredDraft).catch(() => undefined);
          }
          const recoveredAttachments = mergeFailedComposerAttachments(
            current.attachments,
            sentAttachments,
          );
          session.updateAttachments(recoveredAttachments);
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
  const send = useEvent(
    async (textOverride?: string, preference: ComposerSendPreference = "start"): Promise<void> => {
      const submit = captureSend();
      const session = composerSession.capture();
      const current = session.read();
      if (
        textOverride !== undefined ||
        composerTextForSubmission(current).trim() !== "" ||
        composerUploads.readyAttachments(composerUploadScope, current.attachments).length === 0
      ) {
        submit(textOverride, preference);
        return;
      }
      const input = composerInputRef.current;
      if (input === null) {
        submit(undefined, preference);
        return;
      }
      try {
        const nativeValue = await input.getValue();
        session.updateText(nativeValue);
        submit(composerTextForSubmission(nativeValue), preference);
      } catch {
        // The editor can unmount while its native snapshot is in flight. The
        // activation still owns the captured attachment-only submission.
        submit(undefined, preference);
      }
    },
  );
  return { captureSend, send };
}

import type { ActionMenuItem } from "../../ui/ActionMenu";
import type { ComposerDeliveryCapabilities } from "./deliveryCapabilities";
export function useComposerDeliveryActions({
  attachments,
  cancelQueuedComposerEdit,
  clearComposerText,
  composerScope,
  currentTurnId,
  discardVoice,
  draft,
  finishVoice,
  goalSubmissionActive,
  onEditQueued,
  onInterrupt,
  pastedAttachmentPending,
  queuedComposerEdit,
  queuedComposerEditBusy,
  saveQueuedComposerEdit,
  send,
  threadLifecycleActive,
  uploadsBlockSend,
  voiceError,
  voicePhase,
  voiceRetryAvailable,
}: ComposerDeliveryCapabilities) {
  const dialog = useAppDialog();
  const [actionPending, setActionPending] = useConversationState(composerScope, () => false);
  const [interruptRequest, setInterruptRequest] = useConversationState<InterruptRequest>(
    composerScope,
    () => IDLE_INTERRUPT_REQUEST,
  );
  const runAction = useEvent((operation: () => Promise<void>, fallback: string): void => {
    if (actionPending) {
      return;
    }
    setActionPending(true);
    operation().then(
      () => {
        setActionPending(false);
      },
      (error: unknown) => {
        setActionPending(false);
        dialog.alert(fallback, error instanceof Error ? error.message : fallback);
      },
    );
  });
  const runVoiceAction = useEvent((operation: () => Promise<void>, fallback: string): void => {
    // VoiceInputController owns recording/finalization admission. Holding the
    // message-send lock here would block the very discard that cancels a wait.
    void operation().catch((error: unknown) => {
      dialog.alert(fallback, error instanceof Error ? error.message : fallback);
    });
  });
  const requestInterrupt = useEvent(
    (turnId: string, interrupt: (turnId: string) => Promise<void>): void => {
      if (interruptRequest.status === "requested" && interruptRequest.turnId === turnId) {
        return;
      }
      // The RPC can succeed before the thread projection clears currentTurnId.
      // Retain the accepted turn id so that stale UI cannot interrupt it again.
      setInterruptRequest({ status: "requested", turnId });
      runAction(async () => {
        try {
          await interrupt(turnId);
        } catch (error) {
          setInterruptRequest((current) =>
            current.status === "requested" && current.turnId === turnId
              ? IDLE_INTERRUPT_REQUEST
              : current,
          );
          throw error;
        }
      }, "Could not stop response");
    },
  );
  const deliveryActions: ActionMenuItem[] = [
    { disabled: threadLifecycleActive, icon: "send-outline", id: "start", label: "Send now" },
    {
      disabled: !threadLifecycleActive,
      icon: "time-outline",
      id: "queue",
      label: "Queue after current turn",
    },
    {
      disabled: currentTurnId === null,
      icon: "navigate-outline",
      id: "steer",
      label: "Steer active turn",
    },
  ];

  const handleDeliveryAction = useEvent((id: string) => {
    if (queuedComposerEdit !== null || (id !== "start" && id !== "queue" && id !== "steer")) {
      return;
    }
    if (voicePhase !== "idle") {
      runVoiceAction(async () => {
        await finishVoice(true, id);
      }, "Could not finish voice input");
    } else {
      runAction(async () => {
        await send(undefined, id);
      }, "Could not send message");
    }
  });

  const editingQueuedMessage = queuedComposerEdit !== null;

  const stoppingResponse =
    !editingQueuedMessage &&
    !goalSubmissionActive &&
    currentTurnId !== null &&
    voicePhase === "idle" &&
    draft.trim() === "" &&
    attachments.length === 0;
  const interruptAlreadyRequested =
    stoppingResponse &&
    interruptRequest.status === "requested" &&
    interruptRequest.turnId === currentTurnId;

  const sendDisabled =
    actionPending ||
    interruptAlreadyRequested ||
    voicePhase === "finishing" ||
    queuedComposerEditBusy ||
    (editingQueuedMessage && onEditQueued === undefined) ||
    pastedAttachmentPending ||
    uploadsBlockSend ||
    (voicePhase === "idle" &&
      !stoppingResponse &&
      (goalSubmissionActive
        ? draft.trim() === ""
        : draft.trim() === "" && attachments.length === 0));

  const composerDiscardEnabled =
    editingQueuedMessage ||
    voicePhase !== "idle" ||
    voiceRetryAvailable ||
    voiceError !== null ||
    draft !== "";

  const discardComposer = useEvent(() => {
    if (editingQueuedMessage) {
      cancelQueuedComposerEdit();
    } else if (voicePhase !== "idle" || voiceRetryAvailable || voiceError !== null) {
      runVoiceAction(discardVoice, "Could not discard voice input");
    } else {
      clearComposerText();
    }
  });

  const activatePrimaryAction = useEvent(() => {
    if (editingQueuedMessage) {
      saveQueuedComposerEdit();
    } else if (voicePhase !== "idle") {
      runVoiceAction(async () => {
        await finishVoice(true);
      }, "Could not finish voice input");
    } else if (
      currentTurnId !== null &&
      !goalSubmissionActive &&
      onInterrupt !== undefined &&
      draft.trim() === "" &&
      attachments.length === 0
    ) {
      requestInterrupt(currentTurnId, onInterrupt);
    } else {
      runAction(async () => {
        await send();
      }, "Could not send message");
    }
  });

  const steerComposer = useEvent(() => {
    if (
      editingQueuedMessage ||
      goalSubmissionActive ||
      sendDisabled ||
      currentTurnId === null ||
      !threadLifecycleActive
    ) {
      return;
    }
    handleDeliveryAction("steer");
  });
  return {
    activatePrimaryAction,
    composerDiscardEnabled,
    deliveryActions,
    discardComposer,
    editingQueuedMessage,
    handleDeliveryAction,
    sendDisabled,
    steerComposer,
    stoppingResponse,
  };
}
