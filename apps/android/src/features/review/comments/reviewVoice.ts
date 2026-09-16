import { useEffect, useRef } from "react";
import type {
  VoiceTranscriptionEvent,
  VoiceTranscriptionOptions,
  VoiceTranscriptionSession,
} from "../../../data/voice-input-controller";
import { useEvent } from "../../../react/useEvent";
import { codeReviewVoiceInputScope, type CodeReviewLineReference } from "./reviewComment";
import { useMicrophoneAccess } from "../../../ui/use-microphone-access";
import { useVoiceInputResource } from "../../../ui/VoiceInputRuntime";
import type { CodeReviewWorkspaceProps } from "../workspace/codeReviewContract";

type VoiceStarter = (
  listener: (event: VoiceTranscriptionEvent) => void,
  options?: VoiceTranscriptionOptions,
) => Promise<VoiceTranscriptionSession>;
export function useReviewVoice(
  props: CodeReviewWorkspaceProps,
  resourceOwnerId: string,
  selectedReference: CodeReviewLineReference | null,
  selectionRef: { current: { end: number; start: number } },
  updateCommentDraft: (value: string) => void,
  updateReferenceDraft: (reference: CodeReviewLineReference, value: string) => void,
  commitComment: (reference: CodeReviewLineReference, draft: string) => void,
) {
  const { onClose, thread, voiceRuntime } = props;
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
      if (voiceController !== null) {
        microphoneAccess.run(async () => {
          await voiceController.finish(scope, true, (text) => {
            commitComment(reference, text);
          });
        });
      }
    } else {
      commitComment(reference, draft);
    }
  });
  const bindVoice = useEvent((draft: string) => {
    if (voiceController === null || voiceScope === null || selectedReference === null) {
      return;
    }
    // A retained voice binding writes to its captured line after another line opens.
    const reference = selectedReference;
    const updateBoundDraft = (value: string) => {
      updateReferenceDraft(reference, value);
    };
    voiceController.bind({
      scope: voiceScope,
      selection: () => selectionRef.current,
      send: updateBoundDraft,
      source: () => draft,
      thread,
      updateDraft: updateBoundDraft,
      ...(onStartVoiceTranscription === undefined
        ? {}
        : { startRemote: onStartVoiceTranscription }),
    });
  });
  const pressVoice = useEvent(async (draft: string, selection: { end: number; start: number }) => {
    if (voiceController === null || voiceScope === null) {
      return;
    }
    if (
      (voiceResource?.phase === undefined || voiceResource.phase === "idle") &&
      voiceResource?.retryAvailable !== true &&
      !microphoneAccess.allowCapture()
    ) {
      return;
    }
    updateCommentDraft(draft);
    selectionRef.current = selection;
    bindVoice(draft);
    if (voiceResource?.retryAvailable === true) {
      await voiceController.retry(voiceScope);
    } else if (voiceResource?.phase === undefined || voiceResource.phase === "idle") {
      const starting = voiceController.toggle(voiceScope);
      if (voiceRuntime?.resources?.voiceInputs.get(voiceScope)?.phase === "starting") {
        recordingScopeRef.current = voiceScope;
      }
      await starting;
    } else if (voiceResource.phase !== "finishing") {
      await voiceController.finish(voiceScope, false);
    }
  });
  const close = useEvent(() => {
    if (recordingScopeRef.current !== null) {
      const scope = recordingScopeRef.current;
      if (voiceController !== null) {
        microphoneAccess.run(async () => {
          await voiceController.finish(scope, false);
        });
      }
    }
    if (voiceScope !== null) {
      voiceController?.unbind(voiceScope);
    }
    onClose();
  });
  useEffect(
    () => () => {
      const scope = recordingScopeRef.current;
      if (scope === null) {
        return;
      }
      voiceController?.finish(scope, false).catch(() => undefined);
      voiceController?.unbind(scope);
    },
    [voiceController],
  );
  return { addComment, close, microphoneAccess, pressVoice, voiceResource };
}
