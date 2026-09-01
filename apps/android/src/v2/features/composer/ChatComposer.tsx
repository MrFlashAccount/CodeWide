import { useState } from "react";

import { ComposerView } from "../../../presentation/input/ComposerView";
import type { ActionMenuItem } from "../../../ui/ActionMenu";
import { useEvent } from "../../../react/useEvent";
import type { VoiceInputControlModel } from "../conversation/VoiceInputControl";

interface ChatComposerProps {
  disabled: boolean;
  error?: string | null;
  locked?: boolean;
  menuActions?: readonly ActionMenuItem[];
  onEdit?(): void;
  onSelectMenu?(id: string): void;
  onSubmit(text: string): Promise<boolean>;
  onTextChange?(text: string): void;
  retryBlocked?: boolean;
  text?: string;
  voice?: VoiceInputControlModel;
}

export function ChatComposer({
  disabled,
  error,
  locked,
  menuActions,
  onEdit,
  onSelectMenu,
  onSubmit,
  onTextChange,
  retryBlocked = false,
  text: controlledText,
  voice,
}: ChatComposerProps): React.JSX.Element {
  const [uncontrolledText, setUncontrolledText] = useState("");
  const text = controlledText ?? uncontrolledText;
  const [activationError, setActivationError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const submit = useEvent(async (): Promise<void> => {
    const value = text.trim();
    if (disabled || locked === true || retryBlocked || sending || value.length === 0) {
      return;
    }
    setSending(true);
    setActivationError(null);
    await onSubmit(value)
      .then((completed) => {
        if (completed) {
          if (onTextChange === undefined) setUncontrolledText("");
          else onTextChange("");
        }
      })
      .finally(() => setSending(false));
  });
  const activateSubmit = useEvent((): void => {
    submit().catch(() => {
      setActivationError("Action failed. Try again.");
    });
  });
  const changeText = useEvent((value: string) => {
    setActivationError(null);
    if (onTextChange === undefined) setUncontrolledText(value);
    else onTextChange(value);
    onEdit?.();
  });
  return (
    <ComposerView
      disabled={disabled || locked === true}
      {...(error === undefined && activationError === null
        ? {}
        : { error: error ?? activationError })}
      {...(menuActions === undefined ? {} : { menuActions })}
      onChangeText={changeText}
      {...(onSelectMenu === undefined ? {} : { onSelectMenu })}
      onSubmit={activateSubmit}
      {...(voice === undefined
        ? {}
        : {
            onVoice: voice.activate,
            voiceDisabled: voice.disabled,
            voiceMessage: voice.message,
            voiceState: voice.state,
          })}
      pending={sending}
      retryBlocked={retryBlocked}
      text={text}
    />
  );
}
