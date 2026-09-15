import { Ionicons } from "@expo/vector-icons";
import { Button } from "heroui-native/button";
import { ActivityIndicator, View } from "react-native";
import type { RemoteProject } from "../../data/remote-projects";
import { projectIncludesDirectory } from "../../data/remote-projects";
import type { ComposeIconName } from "../../presentation/icons/composeIconNames";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, type AppListRowProps } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ProjectPickerSheet.styles";

export function SectionLabel({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );
}
export function ProjectChoiceRow({
  project,
  cwd,
  busy,
  pinned = false,
  pinning = false,
  position = "only",
  onPin,
  onSelect,
}: {
  project: RemoteProject;
  cwd: string;
  busy: boolean;
  pinned?: boolean;
  pinning?: boolean;
  position?: AppListRowProps["position"];
  onPin?: (() => void) | undefined;
  onSelect(cwd: string | null): Promise<void>;
}) {
  const selected = projectIncludesDirectory(project, cwd);
  return (
    <PickerRow
      position={position}
      icon={pinned ? "pin" : "folder-outline"}
      title={project.name}
      subtitle={project.path}
      selected={selected}
      disabled={busy}
      action={
        onPin === undefined
          ? undefined
          : {
              label: "Pin",
              accessibilityLabel: `Pin ${project.name}`,
              loading: pinning,
              onPress: onPin,
            }
      }
      onPress={() => {
        if (!busy && !selected) void onSelect(project.path);
      }}
    />
  );
}
export function PickerRow({
  icon,
  title,
  subtitle,
  selected,
  disabled,
  chevron = false,
  action,
  position = "only",
  onPress,
}: {
  icon: ComposeIconName;
  title: string;
  subtitle?: string;
  selected: boolean;
  disabled: boolean;
  chevron?: boolean;
  position?: AppListRowProps["position"];
  action?:
    | {
        label: string;
        accessibilityLabel: string;
        loading: boolean;
        onPress(): void;
      }
    | undefined;
  onPress(): void;
}) {
  return (
    <AppListRow
      title={title}
      {...(subtitle === undefined ? {} : { description: subtitle })}
      selected={selected}
      disabled={disabled}
      onPress={onPress}
      position={position}
      fixedHeight={subtitle === undefined ? listRowHeight.single : listRowHeight.double}
      leadingIcon={{ name: icon, size: iconSize.action, color: colors.textMuted }}
      {...(action !== undefined
        ? {
            trailing: (
              <Button
                size="sm"
                variant="outline"
                accessibilityLabel={action.accessibilityLabel}
                isDisabled={disabled || action.loading}
                style={styles.rowAction}
                onPress={action.onPress}
              >
                {action.loading ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  action.label
                )}
              </Button>
            ),
          }
        : chevron
          ? {
              trailingIcon: {
                name: "chevron-forward",
                size: iconSize.inline,
                color: colors.textDim,
              },
            }
          : {})}
    />
  );
}
export function EmptyState({
  icon,
  text,
  compact = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  compact?: boolean;
}) {
  return (
    <View style={[styles.emptyState, compact && styles.emptyStateCompact]}>
      <Ionicons name={icon} size={iconSize.illustration} color={colors.textDim} />
      <Text style={styles.stateText}>{text}</Text>
    </View>
  );
}
