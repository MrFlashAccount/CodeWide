import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, controlHitSlop, iconSize } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text, AppTextInput as TextInput } from "../../../ui/Typography";
import { styles } from "./TimelineSearchBar.styles";
import type { TimelineSearchBarProps } from "./TimelineSearchBarContract";
export function TimelineSearchBar({
  threadSearch,
  updateThreadSearch,
  setThreadSearchMatch,
  scrollToThreadSearchIndex,
  threadSearchMatches,
  threadSearchMatch,
  compact,
  moveThreadSearch,
  closeThreadSearch,
}: TimelineSearchBarProps) {
  return (
    <View style={styles.threadSearchBar}>
      <InlineIcon name="search" role="body" color={colors.textMuted} />
      <TextInput
        autoFocus
        compact
        accessibilityLabel="Search current thread"
        value={threadSearch}
        onChangeText={(value) => {
          updateThreadSearch(value);
          setThreadSearchMatch(0);
          requestAnimationFrame(() => scrollToThreadSearchIndex(0));
        }}
        placeholder="Find in thread"
        placeholderTextColor={colors.textDim}
        style={styles.searchInput}
      />
      <Text style={styles.threadSearchCount}>
        {threadSearchMatches.length === 0
          ? "0"
          : `${threadSearchMatch + 1}/${threadSearchMatches.length}`}
      </Text>
      {!compact && (
        <Pressable
          accessibilityLabel="Previous match"
          hitSlop={controlHitSlop.regular}
          onPress={() => moveThreadSearch(-1)}
          style={styles.searchAction}
        >
          <Ionicons name="chevron-up" size={iconSize.action} color={colors.text} />
        </Pressable>
      )}
      <Pressable
        accessibilityLabel="Next match"
        hitSlop={controlHitSlop.regular}
        onPress={() => moveThreadSearch(1)}
        style={styles.searchAction}
      >
        <Ionicons name="chevron-down" size={iconSize.action} color={colors.text} />
      </Pressable>
      <Pressable
        accessibilityLabel="Close thread search"
        hitSlop={controlHitSlop.regular}
        onPress={closeThreadSearch}
        style={styles.searchAction}
      >
        <Ionicons name="close" size={iconSize.action} color={colors.text} />
      </Pressable>
    </View>
  );
}
