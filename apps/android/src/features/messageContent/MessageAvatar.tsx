import { Image, StyleSheet, View } from "react-native";

import { usePrivateImageUri } from "../../rendering/use-private-image-uri";
import { colors, controlSize, radii, typeScale, typeWeight } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

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
 * Round author avatar. The remote picture resolves through the private image
 * path; without one, until it loads, or when it fails, the login's initials
 * stand in.
 */
export function MessageAvatar({
  avatarUrl,
  login,
}: {
  readonly avatarUrl: string | null;
  readonly login: string;
}): React.JSX.Element {
  const image = usePrivateImageUri(avatarUrl);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.avatar}
    >
      <Text style={styles.initial}>{initialsOf(login)}</Text>
      {image.source === null || image.failed ? null : (
        <Image source={image.source} style={styles.picture} />
      )}
    </View>
  );
}

const AVATAR_SIZE = controlSize.compact;

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.pill,
    height: AVATAR_SIZE,
    justifyContent: "center",
    overflow: "hidden",
    width: AVATAR_SIZE,
  },
  initial: {
    ...typeScale.label,
    color: colors.textMuted,
    fontWeight: typeWeight.semibold,
  },
  picture: {
    ...StyleSheet.absoluteFill,
  },
});
