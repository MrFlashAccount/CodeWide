import { TerminalView, type TerminalViewRef } from "expo-libghostty";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { View } from "react-native";
import { useEvent } from "../../../react/useEvent";
import { colors } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./TaskOutputTerminal.styles";
import {
  HEAD_OMITTED_NOTE,
  type TaskOutputTerminalHandle,
  type TaskOutputTerminalProps,
} from "./TaskOutputTerminal.types";

/** Smaller than prose, like the interactive terminal, so lines rarely wrap. */
const OUTPUT_FONT_SIZE = 11;
/** SGR faint, then reset: the note reads as a quiet line above the output. */
const FAINT = "\u001B[2m";
const RESET = "\u001B[0m";

/**
 * A command's output in a Ghostty terminal, as a terminal shows it: colours,
 * carriage-return progress and other control sequences render, and plain
 * text looks the same as before. Only what the reader read since the last
 * write is written; the terminal keeps the rest in its scrollback. Read-only:
 * no keyboard, cursor or input, while scrolling and copying stay.
 */
export const TaskOutputTerminal = forwardRef<TaskOutputTerminalHandle, TaskOutputTerminalProps>(
  function TaskOutputTerminal({ output }, forwardedRef): ReactElement {
    const terminal = useRef<TerminalViewRef>(null);
    const written = useRef(0);
    const noted = useRef(false);
    const [failure, setFailure] = useState<string | null>(null);
    const findNext = useEvent(async (query: string): Promise<boolean> =>
      terminal.current?.findNext === undefined ? false : terminal.current.findNext(query),
    );
    const findPrevious = useEvent(async (query: string): Promise<boolean> =>
      terminal.current?.findPrevious === undefined ? false : terminal.current.findPrevious(query),
    );
    const clearSearch = useEvent(async (): Promise<void> => {
      await terminal.current?.clearSearch?.();
    });
    useImperativeHandle(forwardedRef, () => ({ clearSearch, findNext, findPrevious }), [
      clearSearch,
      findNext,
      findPrevious,
    ]);
    // WHY effect: the terminal is a native sink with an imperative write API;
    // this only mirrors published output into it after commit.
    useEffect(() => {
      const view = terminal.current;
      const next = nextWrite(output, written.current, noted.current);
      if (view === null || next === null) {
        return;
      }
      written.current = output.totalChars;
      noted.current = noted.current || output.headOmitted;
      view.writeText(next).catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : "Could not show the output");
      });
    }, [output]);
    return (
      <View style={styles.terminal} testID="background-task-output">
        <TerminalView
          fontSize={OUTPUT_FONT_SIZE}
          readOnly
          ref={terminal}
          style={styles.terminalView}
          theme={{
            background: colors.code,
            foreground: colors.text,
            selectionBackground: colors.surfaceHover,
          }}
        />
        {output.totalChars === 0 && !output.headOmitted ? (
          <Text pointerEvents="none" style={[styles.empty, styles.overlay]}>
            No output yet
          </Text>
        ) : null}
        {failure === null ? null : <Text style={styles.error}>{failure}</Text>}
      </View>
    );
  },
);

/**
 * What the terminal has not received yet, as terminal text: the note for an
 * omitted beginning once, then the characters read since `written`.
 */
function nextWrite(
  output: TaskOutputTerminalProps["output"],
  written: number,
  noted: boolean,
): string | null {
  const pending = output.totalChars - written;
  const note = output.headOmitted && !noted ? `${FAINT}${HEAD_OMITTED_NOTE}${RESET}\n` : "";
  if (pending <= 0 && note === "") {
    return null;
  }
  const fresh = pending > 0 ? output.text.slice(Math.max(0, output.text.length - pending)) : "";
  return terminalLines(note + fresh);
}

/**
 * Output written to a file, not a terminal, ends lines with a bare line
 * feed; a terminal also needs the carriage return a TTY would have added.
 */
function terminalLines(text: string): string {
  return text.replaceAll(/\r?\n/gu, "\r\n");
}
