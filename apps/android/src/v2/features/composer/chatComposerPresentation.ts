import type { ComposerAttachmentDraft } from "../../application/composer/composerAttachmentDraft";
import type { ActionMenuItem } from "../../ui/ActionMenu";
import type { VoiceInputControlModel } from "../conversation/VoiceInputControl";

interface ComposerMenuActionProps {
  menuActions: readonly ActionMenuItem[];
}

interface ComposerVoiceProps {
  onVoice(): Promise<void>;
  onVoiceCancel(): Promise<void>;
  voiceCancelDisabled: boolean;
  voiceDisabled: boolean;
  voiceElapsedSeconds: number;
  voiceLevel: number;
  voiceMessage: string | null;
  voiceState: VoiceInputControlModel["captureState"];
}

export async function selectComposerMenu(
  draft: ComposerAttachmentDraft | undefined,
  onSelectMenu: ((id: string) => void) | undefined,
  id: string,
): Promise<void> {
  if (id === "files" && draft !== undefined) return draft.pickFile();
  if (id === "images" && draft !== undefined) return draft.pickImage();
  onSelectMenu?.(id);
}

export function composerMenuActions(
  actions: readonly ActionMenuItem[] | undefined,
  attachments: boolean,
): readonly ActionMenuItem[] | undefined {
  if (!attachments) return actions;
  const retained = (actions ?? []).filter(
    (action) => action.id !== "files" && action.id !== "images",
  );
  return [
    { id: "files", icon: "document-attach-outline", label: "Attach file" },
    { id: "images", icon: "image-outline", label: "Attach image" },
    ...retained,
  ];
}

export function optionalMenuActions(
  menuActions: readonly ActionMenuItem[] | undefined,
): ComposerMenuActionProps | Record<never, never> {
  return menuActions === undefined ? {} : { menuActions };
}

export function voiceProps(
  voice: VoiceInputControlModel | undefined,
  level: number,
  nowMs: number | undefined,
): ComposerVoiceProps | Record<never, never> {
  if (voice === undefined) return {};
  const startedAtMs = voice.startedAtMs ?? nowMs ?? 0;
  const clock = nowMs ?? startedAtMs;
  return {
    onVoice: voice.activate,
    onVoiceCancel: voice.cancel,
    voiceCancelDisabled: voice.captureState === "cancelling",
    voiceDisabled: voice.disabled,
    voiceElapsedSeconds:
      voice.captureState === "recording"
        ? Math.max(0, Math.floor((Math.max(startedAtMs, clock) - startedAtMs) / 1000))
        : 0,
    voiceLevel: level,
    voiceMessage: voice.message,
    voiceState: voice.captureState,
  };
}

export function voiceErrorMessage(voice: VoiceInputControlModel | undefined): string | null {
  if (voice?.state !== "error" && voice?.state !== "retry") return null;
  return voice.message;
}

export function composerActionErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Attachment action failed";
}
