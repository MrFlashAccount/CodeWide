import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, iconSize } from "../theme";

import { listRowStyles as styles } from "./AppListRow.styles";
import { listRowHeight } from "./AppListRow.types";
import type { AttachmentListRowProps } from "./AttachmentListRow.types";
import { AppText } from "./Typography";

const leadingIcons = {
  image: "image-outline",
  audio: "musical-note-outline",
  file: "document-attach-outline",
} as const;
const trailingIcons = { open: "open-outline", download: "download-outline" } as const;

/** RN fallback; Android supplies a Compose-only cell with the same display contract. */
export function AttachmentListRow(props: AttachmentListRowProps) {
  return (
    <View style={[styles.surface, styles[props.position], localStyles.cell]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel}
        onPress={props.onPress}
        style={({ pressed }) => [styles.row, localStyles.cell, pressed && styles.pressed]}
      >
        <View pointerEvents="none" style={styles.slot}>
          <Ionicons
            name={leadingIcons[props.leading]}
            size={iconSize.action}
            color={colors.textMuted}
          />
        </View>
        <View pointerEvents="none" style={styles.text}>
          <AppText numberOfLines={1} ellipsizeMode="middle" style={styles.title}>
            {props.title}
          </AppText>
          <AppText numberOfLines={1} style={styles.description}>
            {props.description}
          </AppText>
        </View>
        <View pointerEvents="none" style={styles.slot}>
          {props.trailing !== undefined && (
            <Ionicons
              name={trailingIcons[props.trailing]}
              size={iconSize.inline}
              color={colors.textDim}
            />
          )}
        </View>
      </Pressable>
      {(props.position === "first" || props.position === "middle") && (
        <View pointerEvents="none" style={styles.separator} />
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({ cell: { height: listRowHeight.double } });
