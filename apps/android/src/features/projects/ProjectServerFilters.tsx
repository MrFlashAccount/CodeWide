import { ScrollView, StyleSheet } from "react-native";
import { AppButton } from "../../presentation/controls/AppButton";
import {
  controlHitSlop,
  controlSize,
  radii,
  spacing,
  colors,
  typeScale,
  typeWeight,
} from "../../theme";
import { AppText } from "../../ui/Typography";
import { ServerIcon } from "../connections/ServerIcon";
import type { ProjectPickerServer } from "./projectPickerContract";

const SERVER_FILTER_HEIGHT = controlSize.compact - spacing.xxs;

const styles = StyleSheet.create({
  chip: {
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    gap: spacing.xxs,
    minHeight: SERVER_FILTER_HEIGHT,
    minWidth: controlSize.touch,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.optical,
  },
  chips: {
    alignItems: "center",
    gap: spacing.xs,
  },
  inactive: { backgroundColor: colors.surfaceContainerHighest },
  label: {
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
  },
  viewport: {
    flexGrow: 0,
    flexShrink: 0,
    height: SERVER_FILTER_HEIGHT,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
});

/** Compact chips filter the project catalogue without changing sidebar scope. */
export function ProjectServerFilters({
  busy,
  onSelect,
  selected,
  servers,
}: {
  readonly busy: boolean;
  readonly onSelect: (connectionId: string | null) => void;
  readonly selected: string | null;
  readonly servers: readonly (Pick<ProjectPickerServer, "id" | "name"> & {
    readonly iconId?: ProjectPickerServer["iconId"];
  })[];
}): React.JSX.Element {
  const options = [{ iconId: null, id: null, name: "All" }, ...servers];
  return (
    <ScrollView
      contentContainerStyle={styles.chips}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.viewport}
    >
      {options.map((server) => (
        <AppButton
          accessibilityLabel={`Filter projects: ${server.name}`}
          accessibilityState={{ selected: selected === server.id }}
          hitSlop={controlHitSlop.compact}
          isDisabled={busy}
          key={server.id ?? "all"}
          onPress={() => {
            onSelect(server.id);
          }}
          size="sm"
          style={[styles.chip, selected !== server.id && styles.inactive]}
          variant={selected === server.id ? "primary" : "secondary"}
        >
          {server.id === null ? null : (
            <ServerIcon
              color={selected === server.id ? colors.onPrimary : colors.textMuted}
              iconId={server.iconId ?? "desktop"}
              metric="caption"
            />
          )}
          <AppText
            numberOfLines={1}
            style={[
              styles.label,
              { color: selected === server.id ? colors.onPrimary : colors.text },
            ]}
          >
            {server.name}
          </AppText>
        </AppButton>
      ))}
    </ScrollView>
  );
}
