import {
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { colors, radii, spacing, touchTarget } from "../../theme";
import { PresentationIcon, type PresentationIconName } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { useEvent } from "../../react/useEvent";

export interface ServerRailRow {
  detail: string;
  emoji: string;
  id: string;
  label: string;
}

interface ServerRailViewProps {
  activeId?: string;
  onAdd?(): void;
  onOpen(id: string): void;
  onSettings?(): void;
  rows: ServerRailRow[];
}

interface ServerRailItemProps {
  active: boolean;
  onOpen(id: string): void;
  row: ServerRailRow;
}

interface RailActionProps {
  icon: PresentationIconName;
  label: string;
  onPress(): void;
}

export function ServerRailView({
  activeId,
  onAdd,
  onOpen,
  onSettings,
  rows,
}: ServerRailViewProps): React.JSX.Element {
  return (
    <View accessibilityLabel="V2 saved servers" style={styles.rail}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        {rows.map((row) => (
          <ServerRailItem active={row.id === activeId} key={row.id} onOpen={onOpen} row={row} />
        ))}
        {onAdd === undefined ? null : <RailAction icon="add" label="Add server" onPress={onAdd} />}
      </ScrollView>
      {onSettings === undefined ? null : (
        <RailAction icon="settings" label="Settings" onPress={onSettings} />
      )}
    </View>
  );
}

function ServerRailItem({ active, onOpen, row }: ServerRailItemProps): React.JSX.Element {
  const open = useEvent(() => onOpen(row.id));
  return (
    <Pressable
      accessibilityLabel={`${row.label}, ${row.detail}`}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={open}
      style={active ? activeAvatarStyle : inactiveAvatarStyle}
    >
      {active ? <View style={styles.activeMarker} /> : null}
      <ProductText style={styles.emoji}>{row.emoji}</ProductText>
      <View style={[styles.status, row.detail === "Enabled" && styles.statusEnabled]} />
    </Pressable>
  );
}

function activeAvatarStyle({ pressed }: PressableStateCallbackType) {
  return [styles.avatar, styles.avatarActive, pressed && styles.pressed];
}

function inactiveAvatarStyle({ pressed }: PressableStateCallbackType) {
  return [styles.avatar, pressed && styles.pressed];
}

function RailAction({ icon, label, onPress }: RailActionProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={railActionStyle}
    >
      <PresentationIcon color={colors.text} name={icon} size={23} />
    </Pressable>
  );
}

function railActionStyle({ pressed }: PressableStateCallbackType) {
  return [styles.avatar, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  activeMarker: {
    backgroundColor: colors.primary,
    borderRadius: 2,
    height: 24,
    left: -10,
    position: "absolute",
    width: 3,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    position: "relative",
    width: touchTarget,
  },
  avatarActive: { backgroundColor: colors.primaryContainer, borderRadius: radii.selected },
  content: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xs },
  emoji: { fontSize: 22, lineHeight: 28 },
  pressed: { opacity: 0.68 },
  rail: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    width: 64,
  },
  scroll: { flex: 1, width: "100%" },
  status: {
    backgroundColor: colors.textDim,
    borderColor: colors.surfaceContainerLowest,
    borderRadius: 6,
    borderWidth: 2,
    bottom: 1,
    height: 12,
    position: "absolute",
    right: -1,
    width: 12,
  },
  statusEnabled: { backgroundColor: colors.green },
});
