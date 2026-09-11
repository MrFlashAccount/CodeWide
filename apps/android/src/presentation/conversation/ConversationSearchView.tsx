import { StyleSheet, TextInput, View } from "react-native";

import { colors, spacing, iconSize, typeScale } from "../../theme";
import { searchFieldLayout } from "../input/searchLayout";
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
    <View testID="conversation-search-field" style={styles.root}>
      <PresentationIcon color={colors.textMuted} name="search" size={iconSize.action} />
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
      <TopBarActionView compact icon="close" label="Close thread search" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  count: { ...typeScale.label, minWidth: 34, textAlign: "right" },
  input: {
    color: colors.text,
    flex: 1,
    ...typeScale.body,

    minWidth: 0,
    paddingVertical: 0,
  },
  root: {
    ...searchFieldLayout,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xxs,
  },
});
