import { View } from "react-native";
import { formatClockTime } from "../../../data/device-time";
import { Bubble, BubbleContent } from "../../../rendering/Bubble";
import { ImagePreviewGroup } from "../../../rendering/ImagePreviewHost";
import { SearchMessage } from "../../../rendering/SearchMessageFocus";
import { RecoverableRenderBoundary } from "../../../ui/RecoverableRenderBoundary";
import { AppText as Text } from "../../../ui/Typography";
import { LargeContentControls } from "../content/FullContentViewer";
import { projectTurnPresentation } from "./turnProjection";
import { styles } from "./TurnTimelineItem.styles";
import type { TurnTimelineItemProps } from "./TurnTimelineItem.types";
import { UserMessageContent } from "./UserMessageContent";

/** User message cluster retains per-item previews, content and timestamp placement. */
export function renderUserTurnBody(
  turn: TurnTimelineItemProps["turn"],
  userBlocks: ReturnType<typeof projectTurnPresentation>["userBlocks"],
  getTransferAccess: TurnTimelineItemProps["getTransferAccess"],
) {
  return (
    <View style={styles.userTurnCluster}>
      <RecoverableRenderBoundary
        scope="bubble"
        label="User message"
        context={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
        resetKey={`${turn.key}:user`}
      >
        <ImagePreviewGroup id={`${turn.key}:user`}>
          <View style={styles.userMessageRow}>
            <Bubble
              variant="user"
              testID="user-bubble"
              errorContext={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
              errorResetKey={`${turn.key}:user`}
            >
              <BubbleContent>
                <View style={styles.userMessageContent}>
                  {userBlocks.map((block, index) => (
                    <SearchMessage key={`${block.key}:${index}`} itemId={block.raw.id}>
                      <View style={styles.userMessageBlock}>
                        <UserMessageContent
                          content={Array.isArray(block.raw.content) ? block.raw.content : []}
                          projectedAttachments={block.raw.codewideAttachments}
                          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                        />
                        <LargeContentControls
                          block={block}
                          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                        />
                      </View>
                    </SearchMessage>
                  ))}
                </View>
              </BubbleContent>
            </Bubble>
            {turn.turn.startedAt !== null && (
              <Text testID="user-message-time" style={styles.messageTime}>
                {formatClockTime(turn.turn.startedAt)}
              </Text>
            )}
          </View>
        </ImagePreviewGroup>
      </RecoverableRenderBoundary>
    </View>
  );
}
