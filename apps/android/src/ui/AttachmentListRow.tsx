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

/** RN fallback; Android supplies a Compose-only cell with the same display contract. */
export function AttachmentListRow(props: AttachmentListRowProps) {
  return (
    <View style={[styles.surface, styles[props.position], localStyles.cell]}>
      <Pressable
        accessibilityLabel={props.accessibilityLabel}
        accessibilityRole="button"
        onPress={props.onPress}
        style={({ pressed }) => [styles.row, localStyles.cell, pressed && styles.pressed]}
      >
        <View pointerEvents="none" style={styles.slot}>
          <Ionicons
            color={colors.textMuted}
            name={leadingIcons[props.leading]}
            size={iconSize.action}
          />
        </View>
        <View pointerEvents="none" style={styles.text}>
          <AppText ellipsizeMode="middle" numberOfLines={1} style={styles.title}>
            {props.title}
          </AppText>
          <AppText numberOfLines={1} style={styles.description}>
            {props.description}
          </AppText>
        </View>
        <View pointerEvents="none" style={styles.slot}>
          {props.trailing !== undefined && (
            <Ionicons
              color={colors.textDim}
              name={trailingIcons[props.trailing]}
              size={iconSize.inline}
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
