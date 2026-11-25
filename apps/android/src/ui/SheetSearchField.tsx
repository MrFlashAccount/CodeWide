import { Ionicons } from "@expo/vector-icons";
import type { Observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { Pressable, StyleSheet, View } from "react-native";

import { searchFieldLayout } from "../presentation/input/searchLayout";
import { useEvent } from "../react/useEvent";
import { colors, controlSize, iconSize, spacing, typeScale } from "../theme";
import { AppTextInput } from "./Typography";

/** A labelled, clearable search field for an open sheet. */
export function SheetSearchField({
  clearLabel,
  label,
  query$,
}: {
  readonly clearLabel: string;
  readonly label: string;
  readonly query$: Observable<string>;
}): React.JSX.Element {
  const value = useSelector(() => query$.get());
  const change = useEvent((text: string) => {
    query$.set(text);
  });
  const clear = useEvent(() => {
    query$.set("");
  });
  return (
    <View style={styles.field}>
      <Ionicons color={colors.textMuted} name="search-outline" size={iconSize.inline} />
      <AppTextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        compact
        onChangeText={change}
        placeholder={label}
        placeholderTextColor={colors.textDim}
        returnKeyType="search"
        style={styles.input}
        value={value}
        voiceInput={false}
      />
      {value !== "" && (
        <Pressable
          accessibilityLabel={clearLabel}
          accessibilityRole="button"
          onPress={clear}
          style={styles.clear}
        >
          <Ionicons color={colors.textMuted} name="close" size={iconSize.action} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clear: {
    alignItems: "center",
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  field: {
    ...searchFieldLayout,
    marginBottom: spacing.xs,
  },
  input: {
    ...typeScale.body,
    color: colors.text,
    flex: 1,
    height: controlSize.regular,
    minWidth: 0,
    padding: 0,
  },
});
