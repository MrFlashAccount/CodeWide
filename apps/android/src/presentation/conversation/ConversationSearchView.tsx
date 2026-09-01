import { StyleSheet, TextInput, View } from "react-native";

import { colors, spacing } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { TopBarActionView } from "../actions/TopBarActionView";

interface ConversationSearchViewProps {
  matchCount: number;
  onChangeText(text: string): void;
  onClose(): void;
  query: string;
}

export function ConversationSearchView({
  matchCount,
  onChangeText,
  onClose,
  query,
}: ConversationSearchViewProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      <PresentationIcon color={colors.textMuted} name="search" size={18} />
      <TextInput
        accessibilityLabel="Search current thread"
        onChangeText={onChangeText}
        placeholder="Find in thread"
        placeholderTextColor={colors.textDim}
        style={styles.input}
        value={query}
      />
      <ProductText style={styles.count} tone="muted">
        {matchCount}
      </ProductText>
      <TopBarActionView icon="close" label="Close thread search" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  count: { fontSize: 11, minWidth: 34, textAlign: "right" },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    minWidth: 0,
    paddingVertical: 0,
  },
  root: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 50,
    paddingLeft: spacing.sm,
  },
});
