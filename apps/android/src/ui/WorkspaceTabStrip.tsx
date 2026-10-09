import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { colors, iconSize } from "../theme";
import { styles } from "./WorkspaceTabStrip.styles";

/** Common scrolling rail and creation affordance; domain-specific limits stay with callers. */
export function WorkspaceTabStrip(props: {
  readonly children: ReactNode;
  readonly compact?: boolean;
  readonly newTabDisabled?: boolean;
  readonly newTabLabel: string;
  readonly onNewTab: () => void;
}): React.JSX.Element {
  return (
    <View style={[styles.root, props.compact === true && styles.compactRoot]}>
      <ScrollView
        contentContainerStyle={[styles.list, props.compact === true && styles.compactList]}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
      >
        {props.children}
      </ScrollView>
      <Pressable
        accessibilityLabel={props.newTabLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled: props.newTabDisabled === true }}
        disabled={props.newTabDisabled === true}
        onPress={props.onNewTab}
        style={({ pressed }) => [
          styles.add,
          props.compact === true && styles.compactAdd,
          pressed && styles.pressed,
          props.newTabDisabled === true && styles.disabled,
        ]}
      >
        <Ionicons color={colors.text} name="add" size={iconSize.action} />
      </Pressable>
    </View>
  );
}
