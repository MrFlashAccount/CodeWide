import { Ionicons } from "@expo/vector-icons";
import { Image, StyleSheet, View, type TextStyle, type ViewStyle } from "react-native";

import { usePrivateImageUri } from "../../rendering/use-private-image-uri";
import { colors, iconSize, radii, typeScale, typeWeight } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import type { MessageAuthor } from "./messageContent";

/** A message header uses 36dp, a reply 28dp and a one-line event 20dp. */
export type MessageAvatarSize = "event" | "message" | "reply";

const WORDS = /[\p{L}\p{N}]+/gu;

/**
 * Up to two initials, upper-cased: the first letters of the login's first two
 * words (`dana-r` → `DR`), or the first letter of a one-word login; `?` when
 * it has no letter or digit.
 */
function initialsOf(login: string): string {
  const [first, second] = login.match(WORDS) ?? [];
  if (first === undefined) {
    return "?";
  }
  return `${first.charAt(0)}${second?.charAt(0) ?? ""}`.toUpperCase();
}

/**
 * Author avatar. A person is round with the login's initials standing in
 * until the remote picture loads (or when there is none, or it fails); an
 * automation account or AI reviewer is a rounded square with a chip or
 * sparkles glyph, so it never reads as a person. The picture resolves through
 * the private image path.
 */
export function MessageAvatar({
  author,
  size,
}: {
  readonly author: MessageAuthor;
  readonly size: MessageAvatarSize;
}): React.JSX.Element {
  const image = usePrivateImageUri(author.avatarUrl);
  const geometry = SIZES[size];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.avatar, geometry.frame, author.marker !== null && geometry.square]}
    >
      {author.marker === null ? (
        <Text style={[styles.initial, geometry.initial]}>{initialsOf(author.login)}</Text>
      ) : (
        <Ionicons
          color={colors.textMuted}
          name={author.marker === "bot" ? "hardware-chip-outline" : "sparkles-outline"}
          size={geometry.glyph}
        />
      )}
      {image.source === null || image.failed ? null : (
        <Image source={image.source} style={styles.picture} />
      )}
    </View>
  );
}

const MESSAGE_SIZE = 36;
const REPLY_SIZE = 28;
const EVENT_SIZE = 20;
const EVENT_INITIAL_SIZE = 9;

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.pill,
    flexShrink: 0,
    justifyContent: "center",
    overflow: "hidden",
  },
  event: {
    height: EVENT_SIZE,
    width: EVENT_SIZE,
  },
  eventInitial: {
    fontSize: EVENT_INITIAL_SIZE,
    lineHeight: EVENT_SIZE,
  },
  eventSquare: {
    borderRadius: radii.compact,
  },
  initial: {
    ...typeScale.label,
    color: colors.textMuted,
    fontWeight: typeWeight.semibold,
  },
  message: {
    height: MESSAGE_SIZE,
    width: MESSAGE_SIZE,
  },
  picture: {
    ...StyleSheet.absoluteFill,
  },
  reply: {
    height: REPLY_SIZE,
    width: REPLY_SIZE,
  },
  replyInitial: {
    ...typeScale.caption,
  },
  square: {
    borderRadius: radii.small,
  },
});

const SIZES: Readonly<
  Record<
    MessageAvatarSize,
    {
      readonly frame: ViewStyle;
      readonly glyph: number;
      readonly initial: TextStyle | null;
      readonly square: ViewStyle;
    }
  >
> = {
  event: {
    frame: styles.event,
    glyph: iconSize.indicator,
    initial: styles.eventInitial,
    square: styles.eventSquare,
  },
  message: {
    frame: styles.message,
    glyph: iconSize.action,
    initial: null,
    square: styles.square,
  },
  reply: {
    frame: styles.reply,
    glyph: iconSize.inline,
    initial: styles.replyInitial,
    square: styles.square,
  },
};
