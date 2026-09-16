import { View } from "react-native";
import { ThreadErrorBanner } from "../../ui/ThreadErrorBanner";
import type { ConversationBottomChromeProps } from "./ConversationBottomChromeContract";

export function ConversationBottomChrome({
  composerContent,
  currentOutcome,
  failureNotice,
  readOnly,
  remoteThread,
  requestPrompt,
  setBottomChromeHeight,
  timeline,
}: ConversationBottomChromeProps) {
  return (
    <View
      onLayout={({ nativeEvent }) => {
        const nextHeight = Math.ceil(nativeEvent.layout.height);
        setBottomChromeHeight((current) =>
          Math.abs(current - nextHeight) < 1 ? current : nextHeight,
        );
      }}
      testID="conversation-bottom-chrome"
    >
      {!readOnly &&
        requestPrompt !== null &&
        !timeline.some((item) => item.kind === "turn" && item.turn.status === "inProgress") && (
          <>{requestPrompt}</>
        )}
      {failureNotice !== null && (
        <ThreadErrorBanner
          acceptsInput={failureNotice.acceptsInput}
          key={`${remoteThread?.id ?? ""}:${currentOutcome?.turnId ?? "unknown"}`}
          message={failureNotice.message}
        />
      )}
      {composerContent}
    </View>
  );
}
