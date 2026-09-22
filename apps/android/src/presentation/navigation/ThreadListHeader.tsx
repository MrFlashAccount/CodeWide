import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { filterIconButtonLayout, filterIconButtonPressed } from "../input/filterIconButtonLayout";
import { colors, iconSize, layoutSize, spacing } from "../../theme";
import { threadListLayout } from "../../ui/thread-list-layout";

type ThreadListHeaderActionProps = {
  readonly accessibilityLabel: string;
  readonly accessibilityState?: ComponentProps<typeof Pressable>["accessibilityState"];
  readonly children?: ReactNode;
  readonly iconSize?: number;
  readonly name: ComponentProps<typeof Ionicons>["name"];
  readonly onPress?: ComponentProps<typeof Pressable>["onPress"];
};

/** Shared Threads chrome row for ordinary and search modes. */
export function ThreadListHeaderRow({
  children,
  testID,
}: {
  readonly children: ReactNode;
  readonly testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.row} testID={testID}>
      {children}
    </View>
  );
}

/** Transparent icon action with the shared Threads header hit target. */
export function ThreadListHeaderAction(props: ThreadListHeaderActionProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={props.accessibilityState}
      onPress={props.onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Ionicons color={colors.text} name={props.name} size={props.iconSize ?? iconSize.action} />
      {props.children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: filterIconButtonLayout,
  pressed: filterIconButtonPressed,
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.optical,
    minHeight: layoutSize.header,
    paddingLeft: spacing.md,
    paddingRight: threadListLayout.edgeInset,
  },
});
