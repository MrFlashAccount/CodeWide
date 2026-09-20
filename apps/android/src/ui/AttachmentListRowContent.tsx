import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, iconSize } from "../theme";

import { listRowStyles as styles } from "./AppListRow.styles";
import { listRowHeight } from "./AppListRow.types";
import type { AttachmentListRowProps } from "./AttachmentListRow.types";
import { AppText } from "./Typography";

const leadingIcons = {
  audio: "musical-note-outline",
  file: "document-attach-outline",
  image: "image-outline",
} as const;
const trailingIcons = { download: "download-outline", open: "open-outline" } as const;

/** Fixed-height attachment cell with synchronously available font icons. */
export function AttachmentListRowContent(props: AttachmentListRowProps): React.JSX.Element {
  return (
    <View style={[styles.surface, styles[props.position], localStyles.cell]}>
      <AttachmentRowButton props={props} />
      <AttachmentRowSeparator position={props.position} />
    </View>
  );
}

function AttachmentRowButton({ props }: { props: AttachmentListRowProps }): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, localStyles.cell, pressed && styles.pressed]}
    >
      <AttachmentRowLeading leading={props.leading} />
      <AttachmentRowText description={props.description} title={props.title} />
      <AttachmentRowTrailing trailing={props.trailing} />
    </Pressable>
  );
}

function AttachmentRowLeading({
  leading,
}: {
  leading: AttachmentListRowProps["leading"];
}): React.JSX.Element {
  return (
    <View pointerEvents="none" style={styles.slot}>
      <Ionicons color={colors.textMuted} name={leadingIcons[leading]} size={iconSize.action} />
    </View>
  );
}

function AttachmentRowText({
  description,
  title,
}: Pick<AttachmentListRowProps, "description" | "title">): React.JSX.Element {
  return (
    <View pointerEvents="none" style={styles.text}>
      <AppText ellipsizeMode="middle" numberOfLines={1} style={styles.title}>
        {title}
      </AppText>
      <AppText numberOfLines={1} style={styles.description}>
        {description}
      </AppText>
    </View>
  );
}

function AttachmentRowTrailing({
  trailing,
}: {
  trailing: AttachmentListRowProps["trailing"];
}): React.JSX.Element {
  const icon =
    trailing === undefined ? null : (
      <Ionicons color={colors.textDim} name={trailingIcons[trailing]} size={iconSize.inline} />
    );
  return (
    <View pointerEvents="none" style={styles.slot}>
      {icon}
    </View>
  );
}

function AttachmentRowSeparator({
  position,
}: {
  position: AttachmentListRowProps["position"];
}): React.JSX.Element | null {
  if (position !== "first" && position !== "middle") {
    return null;
  }
  return <View pointerEvents="none" style={styles.separator} />;
}

const localStyles = StyleSheet.create({ cell: { height: listRowHeight.double } });
