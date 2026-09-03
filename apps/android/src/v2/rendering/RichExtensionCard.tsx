import { StyleSheet, View } from "react-native";

import { colors, radii, spacing } from "../theme";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { CodeBlock } from "./CodeBlock";
import { extensionCardModel } from "./richExtensionModel";

interface RichExtensionCardProps {
  kind: string;
  meta: string | null;
  value: string;
}

export function RichExtensionCard(props: RichExtensionCardProps): React.JSX.Element {
  const { kind, meta, value } = props;
  const model = extensionCardModel(kind, meta, value);
  if (model === null) return <CodeBlock language={`codex-${kind}`} value={value} />;
  return (
    <View accessibilityLabel={model.label} style={styles.card}>
      <Text style={styles.label}>{model.label}</Text>
      {model.detail === null ? null : (
        <Text selectable style={styles.detail}>
          {model.detail}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderSoft,
    borderRadius: radii.small,
    borderWidth: 1,
    gap: spacing.xxs,
    padding: spacing.xs,
    width: "100%",
  },
  detail: { color: colors.textMuted },
  label: { color: colors.text },
});
