import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, controlHitSlop, iconSize } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text, AppTextInput as TextInput } from "../../../ui/Typography";
import { styles } from "./TimelineSearchBar.styles";
import type { TimelineSearchBarProps } from "./TimelineSearchBarContract";

export function TimelineSearchBar({
  closeThreadSearch,
  compact,
  moveThreadSearch,
  scrollToThreadSearchIndex,
  setThreadSearchMatch,
  threadSearch,
  threadSearchMatch,
  threadSearchMatches,
  updateThreadSearch,
}: TimelineSearchBarProps) {
  return (
    <View style={styles.threadSearchBar}>
      <InlineIcon color={colors.textMuted} name="search" role="body" />
      <TextInput
        accessibilityLabel="Search current thread"
        autoFocus
        compact
        onChangeText={(value) => {
          updateThreadSearch(value);
          setThreadSearchMatch(0);
          requestAnimationFrame(() => {
            scrollToThreadSearchIndex(0);
          });
        }}
        placeholder="Find in thread"
        placeholderTextColor={colors.textDim}
        style={styles.searchInput}
        value={threadSearch}
      />
      <Text style={styles.threadSearchCount}>
        {threadSearchMatches.length === 0
          ? "0"
          : `${String(threadSearchMatch + 1)}/${String(threadSearchMatches.length)}`}
      </Text>
      {!compact && (
        <Pressable
          accessibilityLabel="Previous match"
          hitSlop={controlHitSlop.regular}
          onPress={() => {
            moveThreadSearch(-1);
          }}
          style={styles.searchAction}
        >
          <Ionicons color={colors.text} name="chevron-up" size={iconSize.action} />
        </Pressable>
      )}
      <Pressable
        accessibilityLabel="Next match"
        hitSlop={controlHitSlop.regular}
        onPress={() => {
          moveThreadSearch(1);
        }}
        style={styles.searchAction}
      >
        <Ionicons color={colors.text} name="chevron-down" size={iconSize.action} />
      </Pressable>
      <Pressable
        accessibilityLabel="Close thread search"
        hitSlop={controlHitSlop.regular}
        onPress={closeThreadSearch}
        style={styles.searchAction}
      >
        <Ionicons color={colors.text} name="close" size={iconSize.action} />
      </Pressable>
    </View>
  );
}
