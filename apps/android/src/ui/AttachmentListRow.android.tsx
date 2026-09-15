import { Host, ListItem, Text } from "@expo/ui/jetpack-compose";
import { clickable, clip, fillMaxWidth, height, Shapes } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet, View } from "react-native";

import { ComposeNamedIcon } from "../presentation/icons/ComposeNamedIcon";
import { useEvent } from "../react/useEvent";
import { colors, iconSize, radii, typeScale } from "../theme";
import { listRowStyles as styles } from "./AppListRow.styles";
import { listRowHeight } from "./AppListRow.types";
import type { AttachmentListRowProps } from "./AttachmentListRow.types";

const leadingIcons = {
  image: "image-outline",
  audio: "musical-note-outline",
  file: "document-attach-outline",
} as const;
const trailingIcons = { open: "open-outline", download: "download-outline" } as const;

/** LegendList owns virtualization; each cell has one Compose layout/touch subtree. */
export function AttachmentListRow(props: AttachmentListRowProps) {
  const press = useEvent(() => props.onPress());
  const top = props.position === "only" || props.position === "first" ? radii.medium : 0;
  const bottom = props.position === "only" || props.position === "last" ? radii.medium : 0;
  // WHY: Host does not expose RN accessibility props. This wrapper owns the single
  // labelled accessibility action and separator, not Compose content measurement.
  return (
    <View
      style={[styles.surface, styles[props.position], localStyles.cell]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      onAccessibilityTap={press}
    >
      <Host colorScheme="dark" matchContents={false} style={localStyles.cell}>
        <ListItem
          modifiers={[
            fillMaxWidth(),
            height(listRowHeight.double),
            clip(
              Shapes.RoundedCorner({
                topStart: top,
                topEnd: top,
                bottomStart: bottom,
                bottomEnd: bottom,
              }),
            ),
            clickable(press),
          ]}
          colors={{
            containerColor: colors.surfaceContainer,
            contentColor: colors.text,
            supportingContentColor: colors.textMuted,
          }}
        >
          <ListItem.LeadingContent>
            <ComposeNamedIcon
              name={leadingIcons[props.leading]}
              size={iconSize.action}
              color={colors.textMuted}
            />
          </ListItem.LeadingContent>
          <ListItem.HeadlineContent>
            <Text maxLines={1} overflow="ellipsis" style={localStyles.title}>
              {props.title}
            </Text>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <Text maxLines={1} overflow="ellipsis" style={localStyles.description}>
              {props.description}
            </Text>
          </ListItem.SupportingContent>
          {props.trailing !== undefined && (
            <ListItem.TrailingContent>
              <ComposeNamedIcon
                name={trailingIcons[props.trailing]}
                size={iconSize.inline}
                color={colors.textDim}
              />
            </ListItem.TrailingContent>
          )}
        </ListItem>
      </Host>
      {(props.position === "first" || props.position === "middle") && (
        <View pointerEvents="none" style={styles.separator} />
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  cell: {
    width: "100%",
    height: listRowHeight.double,
  },
  title: {
    fontSize: typeScale.body.fontSize,
    lineHeight: typeScale.body.lineHeight,
    fontFamily: "RobotoFlex-Regular",
  },
  description: {
    fontSize: typeScale.label.fontSize,
    lineHeight: typeScale.label.lineHeight,
    fontFamily: "RobotoFlex-Regular",
  },
});
