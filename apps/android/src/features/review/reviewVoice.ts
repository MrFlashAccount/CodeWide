import { useEffect, useRef } from "react";
import type {
  VoiceTranscriptionEvent,
  VoiceTranscriptionOptions,
  VoiceTranscriptionSession,
} from "../../data/voice-input-controller";
import { useEvent } from "../../react/useEvent";
import {
  codeReviewVoiceInputScope,
  type CodeReviewLineReference,
} from "../../rendering/code-review";
import { useMicrophoneAccess } from "../../ui/use-microphone-access";
import { useVoiceInputResource } from "../../ui/VoiceInputRuntime";
import type { CodeReviewWorkspaceProps } from "./codeReviewContract";

type VoiceStarter = (
  listener: (event: VoiceTranscriptionEvent) => void,
  options?: VoiceTranscriptionOptions,
) => Promise<VoiceTranscriptionSession>;
export function useReviewVoice(
  props: CodeReviewWorkspaceProps,
  resourceOwnerId: string,
  selectedReference: CodeReviewLineReference | null,
  selectionRef: { current: { start: number; end: number } },
  updateCommentDraft: (value: string) => void,
  updateReferenceDraft: (reference: CodeReviewLineReference, value: string) => void,
  commitComment: (reference: CodeReviewLineReference, draft: string) => void,
) {
  const { thread, voiceRuntime, onClose } = props;
  const voiceController = voiceRuntime?.controller ?? null;
  const microphoneAccess = useMicrophoneAccess();
  const onStartVoiceTranscription: VoiceStarter | undefined = voiceRuntime?.startRemote;
  const recordingScopeRef = useRef<string | null>(null);
  const voiceScope =
    voiceRuntime === null || selectedReference === null
      ? null
      : codeReviewVoiceInputScope(voiceRuntime.scopePrefix, resourceOwnerId, selectedReference);
  const voiceResource = useVoiceInputResource(voiceRuntime, voiceScope);
  const addComment = useEvent((reference: CodeReviewLineReference, draft: string) => {
    const scope =
      voiceRuntime === null
        ? null
        : codeReviewVoiceInputScope(voiceRuntime.scopePrefix, resourceOwnerId, reference);
    const phase =
      scope === null ? "idle" : (voiceRuntime?.resources?.voiceInputs.get(scope)?.phase ?? "idle");
    if (scope !== null && phase !== "idle") {
      void voiceController?.finish(scope, true, (text) => commitComment(reference, text));
    } else commitComment(reference, draft);
  });
  const bindVoice = useEvent((draft: string) => {
    if (voiceController === null || voiceScope === null || selectedReference === null) return;
    // A retained voice binding writes to its captured line after another line opens.
    const reference = selectedReference;
    const updateBoundDraft = (value: string) => updateReferenceDraft(reference, value);
    voiceController.bind({
      scope: voiceScope,
      source: () => draft,
      selection: () => selectionRef.current,
      thread,
      updateDraft: updateBoundDraft,
      send: updateBoundDraft,
      ...(onStartVoiceTranscription === undefined
        ? {}
        : { startRemote: onStartVoiceTranscription }),
    });
  });
  const pressVoice = useEvent(async (draft: string, selection: { start: number; end: number }) => {
    if (voiceController === null || voiceScope === null) return;
    if (
      (voiceResource?.phase === undefined || voiceResource.phase === "idle") &&
      !voiceResource?.retryAvailable &&
      !microphoneAccess.allowCapture()
    )
      return;
    updateCommentDraft(draft);
    selectionRef.current = selection;
    bindVoice(draft);
    if (voiceResource?.retryAvailable === true) await voiceController.retry(voiceScope);
    else if (voiceResource?.phase === undefined || voiceResource.phase === "idle") {
      const starting = voiceController.toggle(voiceScope);
      if (voiceRuntime?.resources?.voiceInputs.get(voiceScope)?.phase === "starting")
        recordingScopeRef.current = voiceScope;
      await starting;
    } else if (voiceResource.phase !== "finishing") await voiceController.finish(voiceScope, false);
  });
  const close = useEvent(() => {
    if (recordingScopeRef.current !== null)
      void voiceController?.finish(recordingScopeRef.current, false);
    if (voiceScope !== null) voiceController?.unbind(voiceScope);
    onClose();
  });
  useEffect(
    () => () => {
      const scope = recordingScopeRef.current;
      if (scope === null) return;
      void voiceController?.finish(scope, false);
      voiceController?.unbind(scope);
    },
    [voiceController],
  );
  return { voiceResource, microphoneAccess, addComment, pressVoice, close };
}
