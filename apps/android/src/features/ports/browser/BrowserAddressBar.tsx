import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View, type TextInput } from "react-native";
import Reanimated, { Easing, LinearTransition } from "react-native-reanimated";
import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../../../theme";
import { AppText, AppTextInput } from "../../../ui/Typography";
import { resolveBrowserAddress } from "./browser-address";

interface BrowserAddressBarProps {
  readonly url: string;
  readonly onEditingChange?: (editing: boolean) => void;
  readonly onNavigate: (url: string) => void;
}
type AddressEdit =
  | { readonly status: "view" }
  | { readonly status: "edit"; readonly text: string; readonly error: string | null };

/** A draft survives redirects; only submit or cancel gives ownership back to the page. */
export function BrowserAddressBar(props: BrowserAddressBarProps) {
  const [edit, setEdit] = useState<AddressEdit>({ status: "view" });
  const input = useRef<TextInput>(null);
  const focus = () => {
    if (edit.status !== "view") return;
    setEdit({ status: "edit", text: props.url, error: null });
    props.onEditingChange?.(true);
  };
  const change = (text: string) => setEdit({ status: "edit", text, error: null });
  const finishEditing = () => {
    setEdit({ status: "view" });
    props.onEditingChange?.(false);
    input.current?.blur();
  };
  const cancel = () => finishEditing();
  const submit = () => {
    const text = edit.status === "edit" ? edit.text : props.url;
    let errorMessage: string | null = null;
    try {
      const target = resolveBrowserAddress(text, props.url);
      props.onNavigate(target);
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : "Could not open address";
    }
    if (errorMessage !== null) {
      setEdit({ status: "edit", text, error: errorMessage });
      return;
    }
    finishEditing();
  };
  return (
    <Reanimated.View
      layout={addressLayoutTransition}
      style={[styles.root, edit.status === "edit" && styles.rootEditing]}
    >
      <View style={[styles.row, edit.status === "edit" && styles.rowEditing]}>
        <AppTextInput
          ref={input}
          accessibilityLabel="Browser address"
          voiceInput={false}
          value={edit.status === "edit" ? edit.text : props.url}
          onFocus={focus}
          onChangeText={change}
          onSubmitEditing={submit}
          keyboardType="url"
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
          selectTextOnFocus
          multiline={false}
          placeholder="Enter address"
          style={styles.input}
        />
        {edit.status === "edit" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel address editing"
            onPress={cancel}
            style={styles.button}
          >
            <Ionicons name="close" size={iconSize.action} color={colors.textMuted} />
          </Pressable>
        )}
        {edit.status === "edit" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to address"
            onPress={submit}
            style={styles.button}
          >
            <Ionicons name="arrow-forward" size={iconSize.action} color={colors.text} />
          </Pressable>
        )}
      </View>
      {edit.status === "edit" && edit.error !== null && (
        <AppText accessibilityRole="alert" style={styles.error}>
          {edit.error}
        </AppText>
      )}
    </Reanimated.View>
  );
}

const addressLayoutTransition = LinearTransition.duration(240).easing(Easing.inOut(Easing.cubic));

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minWidth: 0,
  },
  rootEditing: { zIndex: 2 },
  row: {
    height: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    backgroundColor: colors.background,
  },
  rowEditing: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    color: colors.text,
    ...typeScale.label,
  },
  button: {
    width: controlSize.regular,
    height: controlSize.regular,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    ...typeScale.caption,
    color: colors.error,
    padding: spacing.xs,
  },
});
