import { useEvent } from "../../react/useEvent";
import { useMicrophoneAccess } from "../../ui/use-microphone-access";
import type { ComposerSendPreference } from "./deliveryMode";
import type { VoiceBindingCapabilities } from "./voice/voiceBindingCapabilities";
export function useVoiceBinding({
  captureDraftMutations,
  captureSend,
  voiceController,
  composerScope,
  draft,
  draftSelectionRef,
  remoteThread,
  onStartVoiceTranscription,
}: VoiceBindingCapabilities) {
  const bindVoiceController = () => {
    const send = captureSend();
    const { updateDraft } = captureDraftMutations();
    if (voiceController === null) return;
    voiceController.bind({
      scope: composerScope,
      source: () => draft,
      selection: () => draftSelectionRef.current,
      thread: remoteThread,
      updateDraft,
      send,
      ...(onStartVoiceTranscription === undefined
        ? {}
        : { startRemote: onStartVoiceTranscription }),
    });
  };

  const microphoneAccess = useMicrophoneAccess();

  const finishVoice = useEvent(
    async (sendAfter: boolean, preference: ComposerSendPreference = "start") => {
      const send = captureSend();
      await voiceController?.finish(composerScope, sendAfter, (text) => send(text, preference));
    },
  );

  const retryVoice = useEvent(async () => {
    bindVoiceController();
    await voiceController?.retry(composerScope);
  });

  const toggleVoice = useEvent(async () => {
    if (!microphoneAccess.allowCapture()) return;
    bindVoiceController();
    await voiceController?.toggle(composerScope);
  });

  const discardVoice = useEvent(async () => {
    await voiceController?.discard(composerScope);
  });
  return { microphoneAccess, finishVoice, retryVoice, toggleVoice, discardVoice };
}

import { useRef } from "react";
import { View } from "react-native";
import type { WorkspaceResourceDatabase } from "../../data/workspace-resource-database";
import { useScopedVoiceInputResource } from "../../ui/VoiceInputRuntime";

export function useComposerVoiceState(
  composerScope: string,
  workspaceResources: WorkspaceResourceDatabase | null,
  draftConnectionId: string | null,
  draftThreadId: string | null,
) {
  const voiceResource = useScopedVoiceInputResource(
    workspaceResources,
    draftConnectionId === null || draftThreadId === null ? null : composerScope,
  );

  const voicePhase = voiceResource?.phase ?? "idle";

  const voiceBackend = voiceResource?.backend ?? "remote";

  const voiceError = voiceResource?.error ?? null;

  const voiceRetryAvailable = voiceResource?.retryAvailable ?? false;

  const pendingVoiceSelection = voiceResource?.pendingSelection ?? null;

  const microphoneButtonRef = useRef<View | null>(null);
  return {
    voiceResource,
    voicePhase,
    voiceBackend,
    voiceError,
    voiceRetryAvailable,
    pendingVoiceSelection,
    microphoneButtonRef,
  };
}
