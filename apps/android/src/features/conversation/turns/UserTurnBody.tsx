import { useContext } from "react";
import { View } from "react-native";
import { formatClockTime } from "../../../data/device-time";
import { UserBubbleSurface, UserTextBubble } from "../../../rendering/Bubble";
import { ImagePreviewGroup } from "../../../rendering/ImagePreviewHost";
import { SearchMessage, SearchMessageFocus } from "../../../rendering/SearchMessageFocus";
import { RecoverableRenderBoundary } from "../../../ui/RecoverableRenderBoundary";
import { AppText as Text } from "../../../ui/Typography";
import { userMessageDocument } from "../content/blockContentDocument";
import { ContentDocumentPress } from "../content/ContentDocumentPress";
import type { projectTurnPresentation } from "./turnProjection";
import { styles } from "./TurnTimelineItem.styles";
import type { TurnTimelineItemProps } from "./TurnTimelineItem.types";
import { plainBubbleText } from "./userMessageBubbleText";
import { UserMessageContent } from "./UserMessageContent";

/** User message cluster retains per-item previews, content and timestamp placement. */
export function UserTurnBody({
  getTransferAccess,
  turn,
  userBlocks,
}: {
  getTransferAccess: TurnTimelineItemProps["getTransferAccess"];
  turn: TurnTimelineItemProps["turn"];
  userBlocks: ReturnType<typeof projectTurnPresentation>["userBlocks"];
}) {
  return (
    <RecoverableRenderBoundary
      context={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
      label="User message"
      resetKey={`${turn.key}:user`}
      scope="bubble"
    >
      <View style={styles.userMessageRow}>
        <UserTurnBubble
          blocks={userBlocks}
          getTransferAccess={getTransferAccess}
          groupId={`${turn.key}:user`}
        />
        {turn.turn.startedAt !== null && (
          <Text style={styles.messageTime} testID="user-message-time">
            {formatClockTime(turn.turn.startedAt)}
          </Text>
        )}
      </View>
    </RecoverableRenderBoundary>
  );
}

/** A short plain message has no gallery or document action. Its selectable text owns the surface. */
function UserTurnBubble({
  blocks,
  getTransferAccess,
  groupId,
}: {
  blocks: ReturnType<typeof projectTurnPresentation>["userBlocks"];
  getTransferAccess: TurnTimelineItemProps["getTransferAccess"];
  groupId: string;
}) {
  const focus = useContext(SearchMessageFocus);
  const only = blocks.length === 1 ? blocks[0] : undefined;
  if (only !== undefined && (focus === null || focus.itemId !== only.raw.id)) {
    const text = plainBubbleText(only);
    if (text !== null) {
      return <UserTextBubble text={text} />;
    }
  }
  return (
    <ImagePreviewGroup id={groupId}>
      <UserBubbleSurface style={styles.userMessageContent} testID="user-bubble">
        {blocks.map((block) => (
          <SearchMessage itemId={block.raw.id} key={block.key}>
            <ContentDocumentPress
              accessibilityLabel="Open full message"
              document={userMessageDocument(block, getTransferAccess ?? null)}
            >
              <UserMessageContent
                content={Array.isArray(block.raw.content) ? block.raw.content : []}
                projectedAttachments={block.raw.codewideAttachments}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              />
            </ContentDocumentPress>
          </SearchMessage>
        ))}
      </UserBubbleSurface>
    </ImagePreviewGroup>
  );
}
