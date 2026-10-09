import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useEvent } from "../../react/useEvent";
import { colors, controlHitSlop, iconSize } from "../../theme";
import { AppTextInput as TextInput } from "../../ui/Typography";
import type { ProjectPickerSession } from "./projectPickerSession";
import { styles } from "./ProjectPickerSheet.styles";

/** Search remains local to the active project or directory page. */
export function ProjectPickerSearch({
  state,
}: {
  readonly state: ProjectPickerSession;
}): React.JSX.Element {
  const { mode, query, setQuery } = state;
  const [searchFocused, setSearchFocused] = useState(false);
  const clearQuery = useEvent(() => {
    setQuery("");
  });
  const focusSearch = useEvent(() => {
    setSearchFocused(true);
  });
  const blurSearch = useEvent(() => {
    setSearchFocused(false);
  });
  return (
    <View style={[styles.searchField, searchFocused ? styles.searchFieldFocused : undefined]}>
      <Ionicons
        color={colors.textMuted}
        name="search"
        pointerEvents="none"
        size={iconSize.inline}
        style={styles.searchIcon}
      />
      <TextInput
        accessibilityLabel="Search"
        accessibilityRole="search"
        onBlur={blurSearch}
        onChangeText={setQuery}
        onFocus={focusSearch}
        placeholder={
          mode === "projects"
            ? "Search projects"
            : mode === "servers"
              ? "Search servers"
              : "Filter folders"
        }
        placeholderTextColor={colors.textDim}
        style={styles.searchInput}
        value={query}
        voiceInput={false}
      />
      {query === "" ? null : (
        <Pressable
          accessibilityLabel="Clear search"
          accessibilityRole="button"
          hitSlop={controlHitSlop.compact}
          onPress={clearQuery}
          style={styles.searchClear}
        >
          <Ionicons color={colors.textMuted} name="close" size={14} />
        </Pressable>
      )}
    </View>
  );
}
