import { Pressable, ScrollView, StyleSheet } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, spacing } from "../../theme";
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

export function ComposerContextStripView({
  items,
  onOpen,
}: ComposerContextStripViewProps): React.JSX.Element {
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

function ComposerContextChip({ item, onOpen }: ComposerContextChipProps): React.JSX.Element {
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
    gap: 6,
    minHeight: 24,
    paddingHorizontal: 9,
  },
  content: {
    alignItems: "center",
    gap: 6,
    paddingBottom: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingTop: 2,
  },
  disabled: { opacity: 0.45 },
  label: {
    color: colors.textMuted,
    flexGrow: 0,
    flexShrink: 0,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
  },
  root: { backgroundColor: colors.surface, flexGrow: 0, flexShrink: 0 },
});
