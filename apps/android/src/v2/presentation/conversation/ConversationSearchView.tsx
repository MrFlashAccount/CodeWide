import { StyleSheet, TextInput, View } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { TopBarActionView } from "../actions/TopBarActionView";

interface ConversationSearchViewProps {
  matchCount: number;
  onChangeText(text: string): void;
  onClose(): void;
  query: string;
}

export function ConversationSearchView(props: ConversationSearchViewProps): React.JSX.Element {
  const { matchCount, onChangeText, onClose, query } = props;
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
  count: { ...typeScale.caption, minWidth: 34, textAlign: "right" },
  input: {
    color: colors.text,
    flex: 1,
    ...typeScale.body,

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
