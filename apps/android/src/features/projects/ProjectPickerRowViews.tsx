import { Ionicons } from "@expo/vector-icons";
import { AppButton as Button } from "../../presentation/controls/AppButton";
import { View } from "react-native";
import type { ServerIconId } from "../../data/serverIcons";
import { ServerIcon } from "../connections/ServerIcon";
import type { ProjectDestination, ProjectPickerChoice } from "./projectPickerContract";
import { projectIncludesDirectory } from "../../data/remote-projects";
import type { ComposeIconName } from "../../presentation/icons/composeIconNames";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, type AppListRowProps } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ProjectPickerSheet.styles";

function choiceIsSelected(
  current: ProjectDestination | null,
  choice: ProjectPickerChoice,
): boolean {
  return (
    current?.connectionId === choice.server.id &&
    projectIncludesDirectory(choice.project, current.cwd ?? "")
  );
}

/** Section heading and count for the virtualized picker. */
export function SectionLabel({ count, title }: { count: number; title: string }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );
}
/** Project selection includes server identity in both its display and callback. */
export function ProjectChoiceRow({
  busy,
  choice,
  current,
  onPin,
  onSelect,
  pinned = false,
  pinning = false,
  position = "only",
}: {
  busy: boolean;
  choice: ProjectPickerChoice;
  current: ProjectDestination | null;
  onPin?: (() => void) | undefined;
  onSelect: (destination: ProjectDestination) => void;
  pinned?: boolean;
  pinning?: boolean;
  position?: AppListRowProps["position"];
}) {
  const { project, server } = choice;
  const selected = choiceIsSelected(current, choice);
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
      disabled={busy || !server.available}
      icon={pinned ? "pin" : "folder-outline"}
      onPress={() => {
        if (!busy && !selected) {
          onSelect({ connectionId: server.id, cwd: project.path });
        }
      }}
      position={position}
      selected={selected}
      serverIconId={server.iconId}
      subtitle={`${server.name} · ${project.path}${server.available ? "" : " · Offline"}`}
      title={project.name}
    />
  );
}
/** Shared selection row with optional project-management action. */
export function PickerRow({
  action,
  chevron = false,
  disabled,
  icon,
  onPress,
  position = "only",
  selected,
  serverIconId,
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
  serverIconId?: ServerIconId;
  subtitle?: string;
  title: string;
}) {
  return (
    <AppListRow
      title={title}
      {...(subtitle === undefined ? {} : { accessibilityHint: subtitle })}
      {...(subtitle === undefined ? {} : { description: subtitle })}
      {...(serverIconId === undefined
        ? {}
        : { descriptionLeading: <ServerIcon iconId={serverIconId} metric="caption" /> })}
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
                <Text shimmering={action.loading} style={styles.sectionTitle}>
                  {action.label}
                </Text>
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
/** Local empty or unavailable picker state. */
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
