import { QuestionDock } from "../requests/QuestionFeature";
import { View, type LayoutChangeEvent } from "react-native";
import { PaneChrome } from "../../ui/PaneChrome";
import { ThreadErrorBanner } from "../../ui/ThreadErrorBanner";
import { ThreadOpenElsewhereNotice } from "../../ui/ThreadOpenElsewhereNotice";
import { threadOpenElsewhere } from "../../data/threadDirectInput";
import { useEvent } from "../../react/useEvent";
import type { ConversationBottomChromeProps } from "./ConversationBottomChromeContract";

/**
 * The conversation's bottom bar: prompts, notices and the composer. It is pane chrome, so it
 * follows the pane's visible width while panes rearrange; the measured box keeps the content
 * width, so its height report fires only when the chrome's height really changes.
 */
export function ConversationBottomChrome({
  composerContent,
  currentOutcome,
  failureNotice,
  openElsewhereActions,
  readOnly,
  remoteThread,
  reportBottomChromeHeight,
  requestPrompt,
  timeline,
}: ConversationBottomChromeProps) {
  const onLayout = useEvent((event: LayoutChangeEvent) => {
    reportBottomChromeHeight(event.nativeEvent.layout.height);
  });
  const openElsewhere = threadOpenElsewhere(remoteThread);
  return (
    <View onLayout={onLayout} testID="conversation-bottom-chrome">
      <PaneChrome testID="conversation-bottom-pane-chrome">
        {!readOnly &&
          requestPrompt !== null &&
          !timeline.some((item) => item.kind === "turn" && item.turn.status === "inProgress") && (
            <>{requestPrompt}</>
          )}
        {/* The persistent notice already says why a send was refused. */}
        {failureNotice !== null &&
          !(openElsewhere && failureNotice.kind === "conversationOpenElsewhere") && (
            <ThreadErrorBanner
              acceptsInput={failureNotice.acceptsInput}
              key={`${remoteThread?.id ?? ""}:${currentOutcome?.turnId ?? "unknown"}`}
              kind={failureNotice.kind}
              message={failureNotice.message}
            />
          )}
        {!readOnly && <QuestionDock />}
        {composerContent}
        {/* It takes the editor's place under the read-only composer's context chips. */}
        {openElsewhere && openElsewhereActions !== null && (
          <ThreadOpenElsewhereNotice
            onCheckAgain={openElsewhereActions.onCheckAgain}
            onFork={openElsewhereActions.onFork}
          />
        )}
      </PaneChrome>
    </View>
  );
}
