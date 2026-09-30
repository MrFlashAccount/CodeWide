import { QuestionDock } from "../requests/QuestionFeature";
import { View, type LayoutChangeEvent } from "react-native";
import { ThreadErrorBanner } from "../../ui/ThreadErrorBanner";
import { useEvent } from "../../react/useEvent";
import type { ConversationBottomChromeProps } from "./ConversationBottomChromeContract";

export function ConversationBottomChrome({
  composerContent,
  currentOutcome,
  failureNotice,
  readOnly,
  remoteThread,
  reportBottomChromeHeight,
  requestPrompt,
  timeline,
}: ConversationBottomChromeProps) {
  const onLayout = useEvent((event: LayoutChangeEvent) => {
    reportBottomChromeHeight(event.nativeEvent.layout.height);
  });
  return (
    <View onLayout={onLayout} testID="conversation-bottom-chrome">
      {!readOnly &&
        requestPrompt !== null &&
        !timeline.some((item) => item.kind === "turn" && item.turn.status === "inProgress") && (
          <>{requestPrompt}</>
        )}
      {failureNotice !== null && (
        <ThreadErrorBanner
          acceptsInput={failureNotice.acceptsInput}
          key={`${remoteThread?.id ?? ""}:${currentOutcome?.turnId ?? "unknown"}`}
          kind={failureNotice.kind}
          message={failureNotice.message}
        />
      )}
      {!readOnly && <QuestionDock />}
      {composerContent}
    </View>
  );
}
