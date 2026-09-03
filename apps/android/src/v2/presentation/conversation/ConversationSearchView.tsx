import { StyleSheet, TextInput, View } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { TopBarActionView } from "../actions/TopBarActionView";
import { VoiceTextInputView, type VoiceTextInputControl } from "../input/VoiceTextInputView";

interface ConversationSearchViewProps {
  canMoveNewer: boolean;
  canMoveOlder: boolean;
  error: string | null;
  loading: boolean;
  matchCount: number;
  onChangeText(text: string): void;
  onClose(): void;
  onMoveNewer(): void;
  onMoveOlder(): void;
  query: string;
  voice?: VoiceTextInputControl;
}

export function ConversationSearchView(props: ConversationSearchViewProps): React.JSX.Element {
  const {
    canMoveNewer,
    canMoveOlder,
    error,
    loading,
    matchCount,
    onChangeText,
    onClose,
    onMoveNewer,
    onMoveOlder,
    query,
    voice,
  } = props;
  const inputProps = {
    accessibilityLabel: "Search current thread",
    // WHY: Search is opened only by an explicit user action; V1 parity puts that action's
    // focus directly in this field so the keyboard and query are ready immediately.
    autoFocus: true,
    onChangeText,
    placeholder: "Find in thread",
    placeholderTextColor: colors.textDim,
    style: styles.input,
    value: query,
  };
  return (
    <View style={styles.root}>
      <View style={styles.controls}>
        <PresentationIcon color={colors.textMuted} name="search" size={18} />
        {voice === undefined ? (
          <TextInput {...inputProps} />
        ) : (
          <VoiceTextInputView containerStyle={styles.inputSlot} {...inputProps} voice={voice} />
        )}
        <ProductText style={styles.count} tone="muted">
          {loading ? "…" : matchCount}
        </ProductText>
        <TopBarActionView
          disabled={loading || !canMoveOlder}
          icon="chevronUp"
          label="Previous thread match"
          onPress={onMoveOlder}
        />
        <TopBarActionView
          disabled={loading || !canMoveNewer}
          icon="chevronDown"
          label="Next thread match"
          onPress={onMoveNewer}
        />
        <TopBarActionView icon="close" label="Close thread search" onPress={onClose} />
      </View>
      {error === null ? null : (
        <ProductText accessibilityRole="alert" style={styles.error} tone="danger">
          {error}
        </ProductText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 50,
    paddingLeft: spacing.sm,
  },
  count: { ...typeScale.caption, minWidth: 34, textAlign: "right" },
  error: { paddingBottom: spacing.xs, paddingHorizontal: spacing.sm, ...typeScale.caption },
  input: {
    color: colors.text,
    flex: 1,
    ...typeScale.body,

    minWidth: 0,
    paddingVertical: 0,
  },
  inputSlot: { flex: 1 },
  root: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
});
