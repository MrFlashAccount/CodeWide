import { useEvent } from "../../react/useEvent";
import { useMicrophoneAccess } from "../../ui/use-microphone-access";
import type { ComposerSendPreference } from "./deliveryMode";
import type { VoiceBindingCapabilities } from "./voice/voiceBindingCapabilities";

export function useVoiceBinding({
  captureDraftMutations,
  captureSend,
  composerScope,
  composerSession,
  draftSelectionRef,
  onStartVoiceTranscription,
  remoteThread,
  voiceController,
}: VoiceBindingCapabilities) {
  const bindVoiceController = () => {
    const send = captureSend();
    const { updateDraft } = captureDraftMutations();
    if (voiceController === null) {
      return;
    }
    voiceController.bind({
      scope: composerScope,
      selection: () => draftSelectionRef.current,
      send,
      source: () => composerSession.read().plainText,
      thread: remoteThread,
      updateDraft,
      ...(onStartVoiceTranscription === undefined
        ? {}
        : { startRemote: onStartVoiceTranscription }),
    });
  };

  const microphoneAccess = useMicrophoneAccess();

  const finishVoice = useEvent(
    async (sendAfter: boolean, preference: ComposerSendPreference = "start") => {
      const send = captureSend();
      await voiceController?.finish(composerScope, sendAfter, (text) => {
        send(text, preference);
      });
    },
  );

  const retryVoice = useEvent(async () => {
    bindVoiceController();
    await voiceController?.retry(composerScope);
  });

  const toggleVoice = useEvent(async () => {
    if (!microphoneAccess.allowCapture()) {
      return;
    }
    bindVoiceController();
    await voiceController?.toggle(composerScope);
  });

  const discardVoice = useEvent(async () => {
    await voiceController?.discard(composerScope);
  });
  return { discardVoice, finishVoice, microphoneAccess, retryVoice, toggleVoice };
}

import { useEffect, useRef } from "react";
import type { View } from "react-native";
import type { WorkspaceResourceDatabase } from "../../data/workspace-resource-database";
import { useAppNotice } from "../../ui/useAppNotice";
import { useScopedVoiceInputResource } from "../../ui/VoiceInputRuntime";

const VOICE_ERROR_NOTICE_DURATION_MS = 3000;

export function useComposerVoiceState(
  composerScope: string,
  workspaceResources: WorkspaceResourceDatabase | null,
  draftConnectionId: string | null,
  draftThreadId: string | null,
) {
  const showNotice = useAppNotice().show;
  const voiceResource = useScopedVoiceInputResource(
    workspaceResources,
    draftConnectionId === null || draftThreadId === null ? null : composerScope,
  );

  const voicePhase = voiceResource?.phase ?? "idle";

  const voiceBackend = voiceResource?.backend ?? "remote";

  const voiceError = voiceResource?.error ?? null;

  useEffect(() => {
    if (voiceError === null) {
      return;
    }
    showNotice({ duration: VOICE_ERROR_NOTICE_DURATION_MS, label: voiceError, variant: "error" });
  }, [showNotice, voiceError]);

  const voiceRetryAvailable = voiceResource?.retryAvailable ?? false;

  const pendingVoiceSelection = voiceResource?.pendingSelection ?? null;

  const microphoneButtonRef = useRef<View | null>(null);
  return {
    microphoneButtonRef,
    pendingVoiceSelection,
    voiceBackend,
    voiceError,
    voicePhase,
    voiceResource,
    voiceRetryAvailable,
  };
}
