import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { DraftSelection } from "../../../data/voice-draft";
import type {
  StartVoiceTranscription,
  VoiceInputController,
} from "../../../data/voice-input-controller";
import type { useComposerDraftCommands } from "../draft";
import type { ComposerSessionBinding } from "../composerSession";
import type { useComposerSubmission } from "../submission";
/** Recording retains the draft activation and final-transcript submission callback. */
export type VoiceBindingCapabilities = {
  captureDraftMutations: ReturnType<typeof useComposerDraftCommands>["captureDraftMutations"];
  captureSend: ReturnType<typeof useComposerSubmission>["captureSend"];
  composerScope: string;
  composerSession: ComposerSessionBinding;
  draftSelectionRef: { current: DraftSelection };
  onStartVoiceTranscription: StartVoiceTranscription | undefined;
  remoteThread: Thread | null | undefined;
  voiceController: VoiceInputController | null;
};
