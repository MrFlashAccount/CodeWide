import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  View,
} from "react-native";

import { colors, radii, spacing, touchTarget } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { ThreadListView, type ThreadListRow } from "./ThreadListView";

interface ThreadSidebarViewProps {
  connectionState: string;
  onNewThread(): void;
  onOpen(id: string): void;
  onSettings(): void;
  rows: ThreadListRow[];
  selectedId?: string;
  title: string;
}

interface HeaderActionProps {
  label: string;
  name: "add" | "settings";
  onPress(): void;
}

export function ThreadSidebarView({
  connectionState,
  onNewThread,
  onOpen,
  onSettings,
  rows,
  selectedId,
  title,
}: ThreadSidebarViewProps): React.JSX.Element {
  const connecting = connectionState !== "live";
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <ProductText numberOfLines={1} style={styles.title} weight="semibold">
          {title}
        </ProductText>
        {connecting ? <ActivityIndicator color={colors.amber} size={14} /> : null}
        <HeaderAction label="New thread" name="add" onPress={onNewThread} />
        <HeaderAction label="Server settings" name="settings" onPress={onSettings} />
      </View>
      <ThreadListView
        onOpen={onOpen}
        rows={rows}
        {...(selectedId === undefined ? {} : { selectedId })}
      />
    </View>
  );
}

function HeaderAction({ label, name, onPress }: HeaderActionProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={headerActionStyle}
    >
      <PresentationIcon color={colors.text} name={name} size={21} />
    </Pressable>
  );
}

function headerActionStyle({ pressed }: PressableStateCallbackType) {
  return [styles.action, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: touchTarget + spacing.md,
    paddingLeft: spacing.sm,
  },
  pressed: { opacity: 0.68 },
  root: { backgroundColor: colors.surface, flex: 1, minHeight: 0 },
  title: { flex: 1, fontSize: 18, lineHeight: 24, minWidth: 0 },
});
