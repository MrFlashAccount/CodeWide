import { View } from "react-native";
import { ThreadErrorBanner } from "../../ui/ThreadErrorBanner";
import type { ConversationBottomChromeProps } from "./ConversationBottomChromeContract";
export function ConversationBottomChrome({
  setBottomChromeHeight,
  readOnly,
  requestPrompt,
  timeline,
  failureNotice,
  remoteThread,
  currentOutcome,
  composerContent,
}: ConversationBottomChromeProps) {
  return (
    <View
      testID="conversation-bottom-chrome"
      onLayout={({ nativeEvent }) => {
        const nextHeight = Math.ceil(nativeEvent.layout.height);
        setBottomChromeHeight((current) =>
          Math.abs(current - nextHeight) < 1 ? current : nextHeight,
        );
      }}
    >
      {!readOnly &&
        requestPrompt !== null &&
        !timeline.some((item) => item.kind === "turn" && item.turn.status === "inProgress") && (
          <>{requestPrompt}</>
        )}
      {failureNotice !== null && (
        <ThreadErrorBanner
          key={`${remoteThread?.id ?? ""}:${currentOutcome?.turnId ?? "unknown"}`}
          message={failureNotice.message}
          acceptsInput={failureNotice.acceptsInput}
        />
      )}
      {composerContent}
    </View>
  );
}
