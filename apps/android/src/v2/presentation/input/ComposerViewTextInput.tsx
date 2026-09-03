import type { RefObject } from "react";
import type { TextInput as NativeTextInput } from "react-native";

import type { ComposerTextInputProps } from "./ComposerView";
import { PresentationTextInput } from "../text/ProductText";

interface ComposerViewTextInputProps extends ComposerTextInputProps {
  inputRef: RefObject<NativeTextInput | null>;
}

/** Keeps the presentation input unaware of the native paste interception bridge. */
export function ComposerViewTextInput(props: ComposerViewTextInputProps): React.JSX.Element {
  const {
    inputRef,
    largePasteThreshold: _threshold,
    onLargePaste: _onLargePaste,
    ...inputProps
  } = props;
  return <PresentationTextInput {...inputProps} ref={inputRef} />;
}
