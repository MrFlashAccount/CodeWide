import { Ionicons } from "@expo/vector-icons";
import { AppButton as Button } from "../../presentation/controls/AppButton";
import { ActivityIndicator, View } from "react-native";
import type { RemoteProject } from "../../data/remote-projects";
import { projectIncludesDirectory } from "../../data/remote-projects";
import type { ComposeIconName } from "../../presentation/icons/composeIconNames";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, type AppListRowProps } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ProjectPickerSheet.styles";

export function SectionLabel({ count, title }: { count: number; title: string }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );
}
export function ProjectChoiceRow({
  busy,
  cwd,
  onPin,
  onSelect,
  pinned = false,
  pinning = false,
  position = "only",
  project,
}: {
  busy: boolean;
  cwd: string;
  onPin?: (() => void) | undefined;
  onSelect: (cwd: string | null) => void;
  pinned?: boolean;
  pinning?: boolean;
  position?: AppListRowProps["position"];
  project: RemoteProject;
}) {
  const selected = projectIncludesDirectory(project, cwd);
  return (
    <PickerRow
      action={
        onPin === undefined
          ? undefined
          : {
              accessibilityLabel: `Pin ${project.name}`,
              label: "Pin",
              loading: pinning,
              onPress: onPin,
            }
      }
      disabled={busy}
      icon={pinned ? "pin" : "folder-outline"}
      onPress={() => {
        if (!busy && !selected) {
          onSelect(project.path);
        }
      }}
      position={position}
      selected={selected}
      subtitle={project.path}
      title={project.name}
    />
  );
}
export function PickerRow({
  action,
  chevron = false,
  disabled,
  icon,
  onPress,
  position = "only",
  selected,
  subtitle,
  title,
}: {
  action?:
    | {
        accessibilityLabel: string;
        label: string;
        loading: boolean;
        onPress: () => void;
      }
    | undefined;
  chevron?: boolean;
  disabled: boolean;
  icon: ComposeIconName;
  onPress: () => void;
  position?: AppListRowProps["position"];
  selected: boolean;
  subtitle?: string;
  title: string;
}) {
  return (
    <AppListRow
      title={title}
      {...(subtitle === undefined ? {} : { description: subtitle })}
      disabled={disabled}
      fixedHeight={subtitle === undefined ? listRowHeight.single : listRowHeight.double}
      leadingIcon={{ color: colors.textMuted, name: icon, size: iconSize.action }}
      onPress={onPress}
      position={position}
      selected={selected}
      {...(action !== undefined
        ? {
            trailing: (
              <Button
                accessibilityLabel={action.accessibilityLabel}
                isDisabled={disabled || action.loading}
                onPress={action.onPress}
                size="sm"
                style={styles.rowAction}
                variant="outline"
              >
                {action.loading ? (
                  <ActivityIndicator color={colors.text} size="small" />
                ) : (
                  action.label
                )}
              </Button>
            ),
          }
        : chevron
          ? {
              trailingIcon: {
                color: colors.textDim,
                name: "chevron-forward",
                size: iconSize.inline,
              },
            }
          : {})}
    />
  );
}
export function EmptyState({
  compact = false,
  icon,
  text,
}: {
  compact?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={[styles.emptyState, compact && styles.emptyStateCompact]}>
      <Ionicons color={colors.textDim} name={icon} size={iconSize.illustration} />
      <Text style={styles.stateText}>{text}</Text>
    </View>
  );
}
