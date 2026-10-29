import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, controlSize, spacing, typeScale } from "../../theme";
import { compactAge } from "../../ui/relativeAge";
import { AppText as Text } from "../../ui/Typography";
import { MessageAuthorName } from "./MessageAuthorName";
import { MessageAvatar } from "./MessageAvatar";
import { MessageBody } from "./MessageBody";
import type { MessageAuthor, MessageContent, MessageReaction } from "./messageContent";
import { MessageReactions } from "./MessageReactions";

/** Everything one message card shows; the owner maps its own DTO into it. */
export type MessageCardProps = {
  readonly author: MessageAuthor;
  /** Optional label beside the author, for example a review verdict. */
  readonly badge?: ReactNode;
  readonly content: MessageContent;
  /**
   * Continues the previous message of the same author: no avatar or header,
   * the body aligned under the previous message's text.
   */
  readonly continuation: boolean;
  readonly createdAt: string;
  /** Draws the hairline that separates it from the message above in one group. */
  readonly divided: boolean;
  readonly edited: boolean;
  readonly nowMs: number;
  readonly reactions: readonly MessageReaction[];
  readonly testID: string;
};

/**
 * One authored message: avatar, login (with a bot or AI marker), relative age
 * and an edited mark, then the rich body and the read-only reactions. A
 * continuation drops the header and keeps only a quiet edited mark. It draws no
 * frame of its own, so the owner groups messages inside one bordered surface.
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
          <MessageAvatar avatarUrl={props.author.avatarUrl} login={props.author.login} />
          <MessageAuthorName author={props.author} />
          {props.badge}
          <Text style={styles.meta}>{props.edited ? `${age} · edited` : age}</Text>
        </View>
      )}
      <MessageBody content={props.content} />
      {props.continuation && props.edited ? <Text style={styles.edited}>edited</Text> : null}
      <MessageReactions reactions={props.reactions} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "stretch",
    gap: spacing.xs,
    padding: spacing.sm,
  },
  // Aligns the body under the previous message's text: past the avatar and its gap.
  continuation: {
    paddingLeft: spacing.sm + controlSize.compact + spacing.xs,
    paddingTop: 0,
  },
  divided: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  edited: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  header: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.compact,
  },
  meta: {
    ...typeScale.label,
    color: colors.textMuted,
    flexShrink: 0,
    marginLeft: "auto",
  },
});
