import { Pressable, ScrollView, StyleSheet } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, typeScale, typeWeight } from "../../theme";
import { PresentationIcon, type PresentationIconName } from "../icons/PresentationIcon";
import { PresentationText as Text } from "../text/ProductText";

export interface ComposerContextItem {
  disabled?: boolean;
  icon?: PresentationIconName;
  id: string;
  label: string;
}

interface ComposerContextStripViewProps {
  items: ComposerContextItem[];
  onOpen(id: string): void;
}

interface ComposerContextChipProps {
  item: ComposerContextItem;
  onOpen(id: string): void;
}

export function ComposerContextStripView(props: ComposerContextStripViewProps): React.JSX.Element {
  const { items, onOpen } = props;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.root}
      testID="composer-context-strip"
    >
      {items.map((item) => (
        <ComposerContextChip item={item} key={item.id} onOpen={onOpen} />
      ))}
    </ScrollView>
  );
}

function ComposerContextChip(props: ComposerContextChipProps): React.JSX.Element {
  const { item, onOpen } = props;
  const open = useEvent(() => onOpen(item.id));
  return (
    <Pressable
      accessibilityLabel={item.label}
      disabled={item.disabled === true}
      onPress={open}
      style={[styles.chip, item.disabled === true && styles.disabled]}
    >
      {item.icon === undefined ? null : (
        <PresentationIcon color={colors.textMuted} name={item.icon} size={15} />
      )}
      <Text style={styles.label}>{item.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceContainer,
    borderRadius: 12,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 24,
    paddingHorizontal: spacing.xs,
  },
  content: {
    alignItems: "center",
    gap: spacing.xs,
    paddingBottom: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.optical,
  },
  disabled: { opacity: 0.45 },
  label: {
    color: colors.textMuted,
    flexGrow: 0,
    flexShrink: 0,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
  },
  root: { backgroundColor: colors.surface, flexGrow: 0, flexShrink: 0 },
});
