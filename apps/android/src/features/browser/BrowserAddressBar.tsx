import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View, type TextInput } from "react-native";
import Reanimated, { Easing, LinearTransition } from "react-native-reanimated";
import { useReducedMotionPreference } from "../../rendering/reduced-motion-store";
import { BROWSER_HOME_URL } from "../../services/browser/browserTab";
import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../../theme";
import { AppText, AppTextInput } from "../../ui/Typography";
import { useEvent } from "../../react/useEvent";
import { resolveBrowserAddress } from "./browser-address";
import { browserTabLabel } from "./browserNavigationPolicy";

interface BrowserAddressBarProps {
  readonly onEditingChange?: (editing: boolean) => void;
  readonly onNavigate: (url: string) => void;
  readonly url: string;
}
type AddressEdit =
  | { readonly status: "view" }
  | { readonly error: string | null; readonly status: "edit"; readonly text: string };

function browserDisplayAddress(url: string): string {
  return url === "about:blank" || url === BROWSER_HOME_URL ? "" : browserTabLabel(url);
}

/** A draft survives redirects; only submit or cancel gives ownership back to the page. */
export function BrowserAddressBar(props: BrowserAddressBarProps): React.JSX.Element {
  const addressTransition = useAddressTransition();
  const displayedAddress = browserDisplayAddress(props.url);
  const [edit, setEdit] = useState<AddressEdit>({ status: "view" });
  const input = useRef<TextInput>(null);
  const focus = useEvent(() => {
    if (edit.status !== "view") {
      return;
    }
    setEdit({
      error: null,
      status: "edit",
      text: props.url === "about:blank" || props.url === BROWSER_HOME_URL ? "" : props.url,
    });
    props.onEditingChange?.(true);
  });
  const change = useEvent((text: string) => {
    setEdit({ error: null, status: "edit", text });
  });
  const finishEditing = useEvent(() => {
    setEdit({ status: "view" });
    props.onEditingChange?.(false);
    input.current?.blur();
  });
  const cancel = useEvent(() => {
    finishEditing();
  });
  const submit = useEvent(() => {
    const text = edit.status === "edit" ? edit.text : props.url;
    let errorMessage: string | null = null;
    try {
      const target = resolveBrowserAddress(text, props.url);
      props.onNavigate(target);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Could not open address";
    }
    if (errorMessage !== null) {
      setEdit({ error: errorMessage, status: "edit", text });
      return;
    }
    finishEditing();
  });
  return (
    <Reanimated.View
      layout={addressTransition}
      style={[styles.root, edit.status === "edit" && styles.rootEditing]}
    >
      <View style={[styles.row, edit.status === "edit" && styles.rowEditing]}>
        <AppTextInput
          accessibilityLabel="Browser address"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          multiline={false}
          onChangeText={change}
          onFocus={focus}
          onSubmitEditing={submit}
          placeholder="Enter address"
          ref={input}
          returnKeyType="go"
          selectTextOnFocus
          style={styles.input}
          value={edit.status === "edit" ? edit.text : displayedAddress}
          voiceInput={false}
        />
        {edit.status === "edit" && (
          <Pressable
            accessibilityLabel="Cancel address editing"
            accessibilityRole="button"
            onPress={cancel}
            style={styles.button}
          >
            <Ionicons color={colors.textMuted} name="close" size={iconSize.action} />
          </Pressable>
        )}
        {edit.status === "edit" && (
          <Pressable
            accessibilityLabel="Go to address"
            accessibilityRole="button"
            onPress={submit}
            style={styles.button}
          >
            <Ionicons color={colors.text} name="arrow-forward" size={iconSize.action} />
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

const ADDRESS_TRANSITION_MS = 240;
const addressLayoutTransition = LinearTransition.duration(ADDRESS_TRANSITION_MS).easing(
  Easing.inOut(Easing.cubic),
);
const reducedAddressTransition = LinearTransition.duration(0);

function useAddressTransition() {
  return useReducedMotionPreference() ? reducedAddressTransition : addressLayoutTransition;
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    flexShrink: 0,
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  error: {
    ...typeScale.caption,
    color: colors.error,
    padding: spacing.xs,
  },
  input: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...typeScale.body,
  },
  root: {
    flex: 1,
    minWidth: 0,
  },
  rootEditing: { zIndex: 2 },
  row: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: "transparent",
    borderRadius: radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: controlSize.regular,
  },
  rowEditing: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});
