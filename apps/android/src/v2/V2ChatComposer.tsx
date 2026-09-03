import { useRef } from "react";
import type { TextInput as NativeTextInput } from "react-native";

import type { ComposerSubmission } from "./application/composer/composerAttachmentTypes";
import type { ComposerAttachmentTarget } from "./application/ports/composerAttachmentTransport";
import { useV2Runtime } from "./application/react/V2RuntimeContext";
import type { SavedServerId } from "./domain/ids";
import { ChatComposer, type ChatComposerProps } from "./features/composer/ChatComposer";
import { useLargePasteInterceptor } from "./infrastructure/react/useLargePasteInterceptor";
import { ComposerViewTextInput } from "./presentation/input/ComposerViewTextInput";
import type { ComposerTextInputProps } from "./presentation/input/ComposerView";
import { useEvent } from "../react/useEvent";

export interface V2ChatComposerProps extends Omit<
  ChatComposerProps,
  "attachmentDraft" | "InputComponent" | "onSubmit"
> {
  draftId: string;
  onSubmit(submission: ComposerSubmission): Promise<boolean>;
  savedServerId: SavedServerId;
  target: ComposerAttachmentTarget;
}

/** Composes the V2 feature with native paste interception and the attachment transport. */
export function V2ChatComposer(props: V2ChatComposerProps): React.JSX.Element {
  const runtime = useV2Runtime();
  const draft = runtime.composerAttachments.draft({
    draftId: props.draftId,
    savedServerId: props.savedServerId,
    target: props.target,
  });
  const submit = useEvent(async (text: string): Promise<boolean> =>
    props.onSubmit({
      prepareInput: async (target) => draft.prepareInput(text, target),
      text,
    }),
  );
  return (
    <ChatComposer
      {...props}
      attachmentDraft={draft}
      InputComponent={LargePasteTextInput}
      onSubmit={submit}
    />
  );
}

function LargePasteTextInput(props: ComposerTextInputProps): React.JSX.Element {
  const inputRef = useRef<NativeTextInput | null>(null);
  useLargePasteInterceptor(inputRef, props.largePasteThreshold, props.onLargePaste);
  return <ComposerViewTextInput {...props} inputRef={inputRef} />;
}
