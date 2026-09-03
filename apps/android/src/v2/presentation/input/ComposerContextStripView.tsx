import { Pressable, ScrollView, StyleSheet } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, typeScale, typeWeight } from "../../theme";
import { PresentationIcon, type PresentationIconName } from "../icons/PresentationIcon";
import { PresentationText as Text } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";

interface ComposerContextMenu {
  accessibilityLabel: string;
  actions: readonly ActionMenuItem[];
  menuWidth?: number;
  onSelect(id: string): void;
}

export interface ComposerContextItem {
  disabled?: boolean;
  icon?: PresentationIconName;
  id: string;
  label: string;
  loading?: boolean;
  menu?: ComposerContextMenu;
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
  const select = useEvent((id: string): void => {
    item.menu?.onSelect(id);
  });
  const chip = (
    <Pressable
      accessibilityLabel={item.menu?.accessibilityLabel ?? item.label}
      accessibilityRole="button"
      accessibilityState={{ busy: item.loading === true, disabled: item.disabled === true }}
      disabled={item.disabled === true}
      onPress={item.menu === undefined ? open : undefined}
      style={[styles.chip, item.disabled === true && styles.disabled]}
    >
      {item.loading === true || item.icon === undefined ? null : (
        <PresentationIcon color={colors.textMuted} name={item.icon} size={15} />
      )}
      {item.loading === true ? (
        <ShimmerText
          containerStyle={styles.labelShimmer}
          style={styles.label}
          text={item.label}
          widthPolicy="intrinsic"
        />
      ) : (
        <Text numberOfLines={1} style={styles.label}>
          {item.label}
        </Text>
      )}
    </Pressable>
  );
  if (item.menu === undefined) return chip;
  return (
    <ActionMenu
      accessibilityLabel={item.menu.accessibilityLabel}
      actions={item.menu.actions}
      {...(item.menu.menuWidth === undefined ? {} : { menuWidth: item.menu.menuWidth })}
      onSelect={select}
      style={styles.menuChip}
    >
      {chip}
    </ActionMenu>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceContainer,
    borderRadius: 12,
    flexDirection: "row",
    flexGrow: 0,
    flexShrink: 0,
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
  labelShimmer: { alignSelf: "center", flexShrink: 0 },
  menuChip: { alignSelf: "flex-start", flexGrow: 0, flexShrink: 0 },
  root: { backgroundColor: colors.surface, flexGrow: 0, flexShrink: 0 },
});
