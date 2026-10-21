import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";

import { colors, iconSize } from "../../../theme";
import { styles } from "./CodeReviewWorkspace.styles";
import type { GuideFocus } from "./useGuideFocus";

/** Header button that shows or hides the guide; absent when the review has no guide binding. */
export function GuideToggle({ guide }: { readonly guide: GuideFocus }): React.JSX.Element | null {
  if (!guide.available) {
    return null;
  }
  return (
    <Pressable
      accessibilityLabel={guide.open ? "Hide guide" : "Show guide"}
      accessibilityRole="button"
      accessibilityState={{ expanded: guide.open }}
      onPress={guide.toggle}
      style={styles.iconButton}
    >
      <Ionicons
        color={colors.text}
        name={guide.open ? "map" : "map-outline"}
        size={iconSize.action}
      />
    </Pressable>
  );
}
