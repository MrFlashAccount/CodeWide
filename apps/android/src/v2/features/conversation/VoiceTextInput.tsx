import { useRef, useState } from "react";
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { insertVoiceTranscript } from "../../application/voiceTranscriptInsertion";
import type { SavedServerId } from "../../domain/ids";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import type { VoiceInputScope } from "../../domain/voiceInputScope";
import {
  VoiceTextInputView,
  type VoiceTextInputViewProps,
} from "../../presentation/input/VoiceTextInputView";
import { useSavedServerVoiceInputControl } from "./VoiceInputControl";

interface VoiceTextInputProps extends Omit<VoiceTextInputViewProps, "voice"> {
  audience: SavedServerId;
  scope: VoiceInputScope;
  thread: QualifiedThread | null;
  value: string;
}

/** Binds a natural-language text field to the process-owned V2 Voice controller. */
export function VoiceTextInput(props: VoiceTextInputProps): React.JSX.Element {
  const {
    audience,
    onChangeText,
    onSelectionChange,
    scope,
    selection,
    thread,
    value,
    ...viewProps
  } = props;
  const selectionRef = useRef({ end: value.length, start: value.length });
  const [pendingSelection, setPendingSelection] = useState<{
    end: number;
    start: number;
  } | null>(null);
  const changeText = useEvent((next: string) => {
    onChangeText?.(next);
  });
  const changeSelection = useEvent(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      selectionRef.current = event.nativeEvent.selection;
      if (
        pendingSelection !== null &&
        pendingSelection.start === event.nativeEvent.selection.start &&
        pendingSelection.end === event.nativeEvent.selection.end
      )
        setPendingSelection(null);
      onSelectionChange?.(event);
    },
  );
  const insertTranscript = useEvent((transcript: string) => {
    const insertion = insertVoiceTranscript(value, selectionRef.current, transcript);
    selectionRef.current = { end: insertion.cursor, start: insertion.cursor };
    setPendingSelection(selectionRef.current);
    onChangeText?.(insertion.text);
  });
  const voice = useSavedServerVoiceInputControl({
    audience,
    onTranscript: insertTranscript,
    scope,
    thread,
  });
  const voiceActive = voice.state !== "error" && voice.state !== "idle";
  return (
    <VoiceTextInputView
      {...viewProps}
      onChangeText={changeText}
      onSelectionChange={changeSelection}
      selection={pendingSelection ?? selection}
      value={value}
      voice={{
        activate: voice.activate,
        disabled: voice.disabled || (viewProps.editable === false && !voiceActive),
        state: voice.state,
      }}
    />
  );
}
