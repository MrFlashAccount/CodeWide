import { StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { compactAge } from "../../ui/relativeAge";
import { AppText as Text } from "../../ui/Typography";
import { MessageAuthorName } from "./MessageAuthorName";
import { MessageAvatar } from "./MessageAvatar";
import type { MessageAuthor, MessageContent, MessageReaction } from "./messageContent";
import { MessageFoldedBody } from "./MessageFoldedBody";
import { MessageReactions } from "./MessageReactions";

/** Everything one message shows; the owner maps its own DTO into it. */
export type MessageCardProps = {
  readonly author: MessageAuthor;
  readonly content: MessageContent;
  /**
   * Continues the previous message of the same author: no avatar or header,
   * only the body (and a quiet edited mark).
   */
  readonly continuation: boolean;
  readonly createdAt: string;
  /** `message` for a top-level message (36dp avatar), `reply` inside a thread (28dp). */
  readonly density: "message" | "reply";
  /** Draws the hairline that separates it from the message above. */
  readonly divided: boolean;
  readonly edited: boolean;
  readonly nowMs: number;
  readonly reactions: readonly MessageReaction[];
  readonly testID: string;
};

/**
 * One authored message, GitHub Mobile style: the avatar beside `login · age`
 * (with an outlined `Bot` / `AI` badge under the login), then the rich body
 * at full width below, folded behind "Read more" when it is long, and the
 * read-only reactions. It draws no frame; the owner places messages on its
 * page or inside a thread.
 */
export function MessageCard(props: MessageCardProps): React.JSX.Element {
  const age = compactAge(props.createdAt, props.nowMs);
  return (
    <View
      style={[
        styles.card,
        props.divided && styles.divided,
        props.continuation && styles.continuation,
      ]}
      testID={props.testID}
    >
      {props.continuation ? null : (
        <View style={styles.header}>
          <MessageAvatar author={props.author} size={props.density} />
          <MessageAuthorName age={props.edited ? `${age} · edited` : age} author={props.author} />
        </View>
      )}
      <MessageFoldedBody content={props.content} testID={props.testID} />
      {props.continuation && props.edited ? <Text style={styles.edited}>edited</Text> : null}
      <MessageReactions reactions={props.reactions} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "stretch",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  continuation: {
    paddingTop: 0,
  },
  divided: {
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  edited: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  header: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
  },
});
