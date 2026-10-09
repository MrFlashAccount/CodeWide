import { desktopInputAvailable } from "./desktopInputAvailability";
import { useImperativeHandle, useRef } from "react";
import {
  findNodeHandle,
  requireNativeComponent,
  UIManager,
  View,
  type ViewProps,
} from "react-native";
import { useEvent } from "../react/useEvent";
import type { DesktopInputTargetProps } from "./desktopInputContract";
import { styles } from "./DesktopInputTarget.styles";

type NativeProps = ViewProps & {
  readonly heldButton: number;
  readonly inputEnabled: boolean;
  readonly modifiers: number;
  readonly onInputReset: () => void;
  readonly sensitivity: number;
  readonly sessionKey: string;
};

const NativeTarget = requireNativeComponent<NativeProps>("CodeWideDesktopInput");

/** Hosts exactly one browser view and routes local commands through its native owner. */
export function DesktopInputTarget({
  children,
  enabled,
  heldButton,
  modifiers,
  onReset,
  ref,
  sensitivity,
  sessionKey,
}: DesktopInputTargetProps): React.JSX.Element {
  const target = useRef<React.ComponentRef<typeof NativeTarget> | null>(null);
  const command = useEvent((name: string, values: number[]): void => {
    const tag = findNodeHandle(target.current);
    if (tag !== null && enabled) {
      UIManager.dispatchViewManagerCommand(tag, name, values);
    }
  });
  const click = useEvent((button: number): void => {
    command("click", [button]);
  });
  const keyboard = useEvent((): void => {
    command("keyboard", []);
  });
  const sendKey = useEvent(
    (chord: { readonly keyCode: number; readonly modifiers: number }): void => {
      command("key", [chord.keyCode, chord.modifiers]);
    },
  );
  useImperativeHandle(ref, () => ({ click, keyboard, sendKey }), [click, keyboard, sendKey]);
  if (!desktopInputAvailable) {
    return <View style={styles.target}>{children}</View>;
  }
  return (
    <NativeTarget
      heldButton={heldButton}
      inputEnabled={enabled}
      modifiers={modifiers}
      onInputReset={onReset}
      ref={target}
      sensitivity={sensitivity}
      sessionKey={sessionKey}
      style={styles.target}
    >
      {children}
    </NativeTarget>
  );
}
