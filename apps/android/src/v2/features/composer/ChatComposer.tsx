import { useState } from "react";

import { ComposerView } from "../../../presentation/input/ComposerView";
import { useEvent } from "../../../react/useEvent";

interface ChatComposerProps {
  disabled: boolean;
  error?: string | null;
  locked?: boolean;
  onEdit?(): void;
  onSubmit(text: string): Promise<boolean>;
  onTextChange?(text: string): void;
  retryBlocked?: boolean;
  text?: string;
}

export function ChatComposer({
  disabled,
  error,
  locked,
  onEdit,
  onSubmit,
  onTextChange,
  retryBlocked = false,
  text: controlledText,
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
      onChangeText={changeText}
      onSubmit={activateSubmit}
      pending={sending}
      retryBlocked={retryBlocked}
      text={text}
    />
  );
}
