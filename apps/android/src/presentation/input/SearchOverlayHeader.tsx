import { Ionicons } from "@expo/vector-icons";
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { Pressable, StyleSheet, View, type TextInput as NativeTextInput } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, controlHitSlop, controlSize, iconSize, typeScale } from "../../theme";
import { AppTextInput as TextInput } from "../../ui/Typography";
import { ThreadListHeaderAction, ThreadListHeaderRow } from "../navigation/ThreadListHeader";
import { filterIconButtonPressed } from "./filterIconButtonLayout";
import { searchFieldLayout } from "./searchLayout";

/** Shared search-mode chrome used by catalog overlays. */
export function SearchOverlayHeader({
  accessibilityLabel,
  backAccessibilityLabel,
  fieldTestID,
  focusOnMount,
  onBack,
  onChangeText,
  onFocus,
  onSubmit,
  placeholder,
  rowTestID,
  testID,
  trailing,
  value,
}: {
  readonly accessibilityLabel: string;
  readonly backAccessibilityLabel: string;
  readonly fieldTestID?: string;
  readonly focusOnMount?: boolean;
  readonly onBack: () => void;
  readonly onChangeText: (text: string) => void;
  readonly onFocus?: () => void;
  readonly onSubmit: () => void;
  readonly placeholder: string;
  readonly rowTestID?: string;
  readonly testID: string;
  readonly trailing?: ReactNode;
  readonly value: string;
}): React.JSX.Element {
  const inputRef = useRef<NativeTextInput>(null);
  useLayoutEffect(() => {
    if (focusOnMount === true) {
      inputRef.current?.focus();
    }
  }, [focusOnMount]);
  return (
    <ThreadListHeaderRow testID={rowTestID ?? `${testID}-row`}>
      <ThreadListHeaderAction
        accessibilityLabel={backAccessibilityLabel}
        iconSize={iconSize.navigation}
        name="arrow-back"
        onPress={onBack}
      />
      <View style={styles.header} testID={testID}>
        <SearchField
          accessibilityLabel={accessibilityLabel}
          inputRef={inputRef}
          onChangeText={onChangeText}
          onSubmit={onSubmit}
          placeholder={placeholder}
          testID={fieldTestID ?? `${testID}-field`}
          value={value}
          {...(onFocus === undefined ? {} : { onFocus })}
        />
        {trailing}
      </View>
    </ThreadListHeaderRow>
  );
}

function SearchField({
  accessibilityLabel,
  inputRef,
  onChangeText,
  onFocus,
  onSubmit,
  placeholder,
  testID,
  value,
}: {
  readonly accessibilityLabel: string;
  readonly inputRef: RefObject<NativeTextInput | null>;
  readonly onChangeText: (text: string) => void;
  readonly onFocus?: () => void;
  readonly onSubmit: () => void;
  readonly placeholder: string;
  readonly testID: string;
  readonly value: string;
}): React.JSX.Element {
  const clear = useEvent((): void => {
    onChangeText("");
  });
  return (
    <View style={styles.searchBar} testID={testID}>
      <Ionicons color={colors.textMuted} name="search" size={iconSize.inline} />
      <TextInput
        accessibilityLabel={accessibilityLabel}
        compact
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        ref={inputRef}
        returnKeyType="search"
        style={styles.input}
        value={value}
        {...(onFocus === undefined ? {} : { onFocus })}
      />
      {value === "" ? null : <ClearSearchButton onPress={clear} />}
    </View>
  );
}

function ClearSearchButton({ onPress }: { readonly onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel="Clear search query"
      accessibilityRole="button"
      hitSlop={controlHitSlop.regular}
      onPress={onPress}
      style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
    >
      <Ionicons color={colors.textMuted} name="close" size={iconSize.action} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  clearButton: {
    alignItems: "center",
    borderRadius: controlSize.regular,
    flexShrink: 0,
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  header: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
  input: {
    ...typeScale.body,
    color: colors.text,
    flex: 1,
    height: controlSize.regular,
    minWidth: 0,
    padding: 0,
  },
  pressed: filterIconButtonPressed,
  searchBar: {
    ...searchFieldLayout,
    flex: 1,
    height: controlSize.regular,
    minWidth: 0,
  },
});
