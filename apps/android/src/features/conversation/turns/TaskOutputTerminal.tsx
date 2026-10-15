import { useRef, type ReactElement } from "react";
import { ScrollView, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useEvent } from "../../../react/useEvent";
import { stripTerminalControlSequences } from "../../../rendering/native-code-block";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./TaskOutputTerminal.styles";
import { HEAD_OMITTED_NOTE, type TaskOutputTerminalProps } from "./TaskOutputTerminal.types";

/** How close to the end a scroll still follows new output. */
const FOLLOW_SLACK = 48;

/**
 * Where no terminal renders (web): the output as plain wrapped text, opened
 * at its end and following new output while the reader stays there.
 */
export function TaskOutputTerminal({ output }: TaskOutputTerminalProps): ReactElement {
  const scroll = useRef<ScrollView>(null);
  const following = useRef(true);
  const onScroll = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    following.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - FOLLOW_SLACK;
  });
  const onContentSizeChange = useEvent(() => {
    if (following.current) {
      scroll.current?.scrollToEnd({ animated: false });
    }
  });
  const text = stripTerminalControlSequences(output.text);
  return (
    <ScrollView
      contentContainerStyle={styles.terminalContent}
      onContentSizeChange={onContentSizeChange}
      onScroll={onScroll}
      ref={scroll}
      scrollEventThrottle={100}
      style={styles.terminal}
      testID="background-task-output"
    >
      {output.headOmitted ? <Text style={styles.omitted}>{HEAD_OMITTED_NOTE}</Text> : null}
      {text === "" ? (
        <Text style={styles.empty}>No output yet</Text>
      ) : (
        <Text selectable style={styles.output}>
          {text}
        </Text>
      )}
    </ScrollView>
  );
}
