import { forwardRef, useImperativeHandle, useState } from "react";
import { Text } from "react-native";

export const terminalClearSearch = jest.fn(async () => undefined);
export const terminalFindNext = jest.fn(async () => true);
export const terminalFindPrevious = jest.fn(async () => true);

/** The Ghostty view is native: this double keeps what a screen writes into it. */
export const TerminalView = forwardRef<unknown, { readonly readOnly?: boolean }>(
  function TerminalView(props, ref) {
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
      <Text testID="terminal-grid" accessibilityHint={props.readOnly === true ? "read-only" : ""}>
        {written}
      </Text>
    );
  },
);
