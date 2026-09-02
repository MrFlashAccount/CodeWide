import { useState, useTransition } from "react";
import {
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale, typeTracking } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ShimmerText } from "../text/ShimmerText";
import {
  PresentationSheetScrollView,
  PresentationSheetView,
} from "../surfaces/PresentationSheetView";
import { ProductText } from "../text/ProductText";

export interface ProjectPickerRow {
  id: string;
  label: string;
  path: string;
  pinned: boolean;
}

interface ProjectPickerViewProps {
  currentPath: string | null;
  isOpen: boolean;
  onOpenChange(isOpen: boolean): void;
  onSelect(path: string | null): Promise<void>;
  projects: readonly ProjectPickerRow[];
}

interface ProjectRowViewProps {
  disabled: boolean;
  onSelect(path: string | null): void;
  project: ProjectPickerRow;
  selected: boolean;
}

interface SectionLabelProps {
  count: number;
  title: string;
}

export function ProjectPickerView(props: ProjectPickerViewProps): React.JSX.Element {
  const { currentPath, isOpen, onOpenChange, onSelect, projects } = props;
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects =
    normalizedQuery === ""
      ? projects
      : projects.filter((project) =>
          `${project.label}\n${project.path}`.toLocaleLowerCase().includes(normalizedQuery),
        );
  const select = useEvent((path: string | null): void => {
    if (pending) return;
    startTransition(async () => {
      await onSelect(path);
      onOpenChange(false);
    });
  });
  const close = useEvent(() => onOpenChange(false));
  const selectDefault = useEvent(() => select(null));
  return (
    <PresentationSheetView
      contentProps={{
        enableDynamicSizing: false,
        enableOverDrag: false,
        index: 0,
        snapPoints: ["62%", "92%"],
      }}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <ProductText style={styles.title} weight="semibold">
            Choose project
          </ProductText>
          <ProductText numberOfLines={1} style={styles.subtitle} tone="muted">
            {projects.filter((project) => project.pinned).length} pinned · {projects.length} total
          </ProductText>
        </View>
        {pending ? <ShimmerText style={styles.pendingText} text="Opening…" /> : null}
        <Pressable
          accessibilityLabel="Close project picker"
          accessibilityRole="button"
          onPress={close}
          style={closeStyle}
        >
          <PresentationIcon color={colors.text} name="close" size={21} />
        </Pressable>
      </View>
      <View style={styles.search}>
        <PresentationIcon color={colors.textMuted} name="search" size={20} />
        <TextInput
          accessibilityLabel="Search projects"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="Search projects"
          placeholderTextColor={colors.textDim}
          style={styles.searchInput}
          value={query}
        />
      </View>
      <PresentationSheetScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
      >
        <SectionLabel
          count={visibleProjects.length}
          title={normalizedQuery === "" ? "Pinned" : "Search results"}
        />
        {visibleProjects.map((project) => (
          <ProjectRowView
            disabled={pending}
            key={project.id}
            onSelect={select}
            project={project}
            selected={project.path === currentPath}
          />
        ))}
        {visibleProjects.length === 0 ? (
          <View style={styles.empty}>
            <PresentationIcon color={colors.textDim} name="search" size={24} />
            <ProductText tone="muted">No matching projects</ProductText>
          </View>
        ) : null}
        {normalizedQuery === "" ? (
          <Pressable
            accessibilityLabel="Server default"
            accessibilityRole="button"
            accessibilityState={{ disabled: pending, selected: currentPath === null }}
            disabled={pending}
            onPress={selectDefault}
            style={currentPath === null ? selectedRowStyle : rowStyle}
          >
            <View style={styles.rowIcon}>
              <PresentationIcon color={colors.textMuted} name="server" size={21} />
            </View>
            <View style={styles.rowCopy}>
              <ProductText style={styles.rowTitle} weight="semibold">
                Server default
              </ProductText>
              <ProductText style={styles.rowDetail} tone="muted">
                Let Codex choose the working directory
              </ProductText>
            </View>
            <PresentationIcon
              color={currentPath === null ? colors.accent : colors.textDim}
              name={currentPath === null ? "checkCircle" : "radio"}
              size={20}
            />
          </Pressable>
        ) : null}
      </PresentationSheetScrollView>
    </PresentationSheetView>
  );
}

function ProjectRowView(props: ProjectRowViewProps): React.JSX.Element {
  const { disabled, onSelect, project, selected } = props;
  const select = useEvent(() => onSelect(project.path));
  return (
    <Pressable
      accessibilityLabel={`Project ${project.path}`}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={select}
      style={selected ? selectedRowStyle : rowStyle}
    >
      <View style={styles.rowIcon}>
        <PresentationIcon
          color={project.pinned ? colors.accent : colors.textMuted}
          name={project.pinned ? "pin" : "folder"}
          size={20}
        />
      </View>
      <View style={styles.rowCopy}>
        <ProductText numberOfLines={1} style={styles.rowTitle} weight="semibold">
          {project.label}
        </ProductText>
        <ProductText numberOfLines={1} style={styles.rowDetail} tone="muted">
          {project.path}
        </ProductText>
      </View>
      <PresentationIcon
        color={selected ? colors.accent : colors.textDim}
        name={selected ? "checkCircle" : "radio"}
        size={20}
      />
    </Pressable>
  );
}

function SectionLabel(props: SectionLabelProps): React.JSX.Element {
  const { count, title } = props;
  return (
    <View style={styles.section}>
      <ProductText style={styles.sectionTitle} tone="muted" weight="semibold">
        {title}
      </ProductText>
      <ProductText style={styles.sectionCount} tone="muted">
        {count}
      </ProductText>
    </View>
  );
}

function closeStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.close, pressed && styles.pressed];
}

function rowStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.row, pressed && styles.pressed];
}

function selectedRowStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.row, styles.rowSelected, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  close: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  content: { paddingBottom: spacing.lg },
  empty: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xl },
  header: { alignItems: "center", flexDirection: "row", minHeight: 56 },
  headerCopy: { flex: 1, minWidth: 0 },
  pendingText: { color: colors.accent, ...typeScale.caption },
  list: { flex: 1, minHeight: 0 },
  pressed: { opacity: 0.68 },
  row: {
    alignItems: "center",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowDetail: { ...typeScale.label, marginTop: spacing.optical },
  rowIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  rowSelected: { backgroundColor: colors.secondaryContainer },
  rowTitle: { ...typeScale.body },
  search: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    ...typeScale.body,
  },
  section: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingBottom: spacing.xxs,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  sectionCount: { ...typeScale.caption },
  sectionTitle: {
    ...typeScale.caption,
    letterSpacing: typeTracking.caps,
    textTransform: "uppercase",
  },
  subtitle: { ...typeScale.label },
  title: { ...typeScale.heading },
});
