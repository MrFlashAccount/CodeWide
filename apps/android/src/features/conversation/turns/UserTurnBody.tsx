import { View } from "react-native";
import { formatClockTime } from "../../../data/device-time";
import { Bubble, BubbleContent } from "../../../rendering/Bubble";
import { ImagePreviewGroup } from "../../../rendering/ImagePreviewHost";
import { SearchMessage } from "../../../rendering/SearchMessageFocus";
import { RecoverableRenderBoundary } from "../../../ui/RecoverableRenderBoundary";
import { AppText as Text } from "../../../ui/Typography";
import { LargeContentControls } from "../content/FullContentViewer";
import type { projectTurnPresentation } from "./turnProjection";
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
        context={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
        label="User message"
        resetKey={`${turn.key}:user`}
        scope="bubble"
      >
        <ImagePreviewGroup id={`${turn.key}:user`}>
          <View style={styles.userMessageRow}>
            <Bubble
              errorContext={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
              errorResetKey={`${turn.key}:user`}
              testID="user-bubble"
              variant="user"
            >
              <BubbleContent>
                <View style={styles.userMessageContent}>
                  {userBlocks.map((block) => (
                    <SearchMessage itemId={block.raw.id} key={block.key}>
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
              <Text style={styles.messageTime} testID="user-message-time">
                {formatClockTime(turn.turn.startedAt)}
              </Text>
            )}
          </View>
        </ImagePreviewGroup>
      </RecoverableRenderBoundary>
    </View>
  );
}
