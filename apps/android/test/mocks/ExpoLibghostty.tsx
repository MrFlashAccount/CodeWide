import { forwardRef, useImperativeHandle, useState } from "react";
import { Text, type StyleProp, type ViewStyle } from "react-native";

export const terminalClearSearch = jest.fn(async () => undefined);
export const terminalFindNext = jest.fn(async () => true);
export const terminalFindPrevious = jest.fn(async () => true);

/** The Ghostty view is native: this double keeps what a screen writes into it. */
export const TerminalView = forwardRef<
  unknown,
  { readonly readOnly?: boolean; readonly style?: StyleProp<ViewStyle> }
>(function TerminalView(props, ref) {
  const [written, setWritten] = useState("");
  useImperativeHandle(ref, () => ({
    clearSearch: terminalClearSearch,
    findNext: terminalFindNext,
    findPrevious: terminalFindPrevious,
    finish: async () => undefined,
    write: async () => undefined,
    writeText: async (text: string) => {
      setWritten((current) => current + text);
    },
  }));
  return (
    <Text
      accessibilityHint={props.readOnly === true ? "read-only" : ""}
      style={props.style}
      testID="terminal-grid"
    >
      {written}
    </Text>
  );
});
