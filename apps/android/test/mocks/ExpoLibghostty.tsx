import { useImperativeHandle, useState, type Ref } from "react";
import { Text } from "react-native";

/** The Ghostty view is native: this double keeps what a screen writes into it. */
export function TerminalView(props: { readonly readOnly?: boolean; readonly ref?: Ref<unknown> }) {
  const [written, setWritten] = useState("");
  useImperativeHandle(props.ref, () => ({
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
}
