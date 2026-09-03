import { Pressable, type PressableStateCallbackType, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { PresentationSheetScrollView } from "../surfaces/PresentationSheetView";
import { ProductText } from "../text/ProductText";
import type { ProjectPickerRow } from "./ProjectPickerView";
import { ProjectPickerCopy, ProjectPickerRowView } from "./ProjectPickerRowView";
import { projectPickerStyles as styles } from "./projectPickerStyles";

interface ProjectPickerListViewProps {
  actionError: string | null;
  currentPath: string | null;
  matchingProjects: readonly ProjectPickerRow[];
  mutationsDisabled: boolean;
  normalizedQuery: string;
  onPin(project: ProjectPickerRow): void;
  onSelect(path: string | null): void;
  pending: boolean;
  pinnedProjects: readonly ProjectPickerRow[];
  pinningPath: string | null;
  recentProjects: readonly ProjectPickerRow[];
}

interface SectionLabelProps {
  count: number;
  title: string;
}

export function ProjectPickerListView(props: ProjectPickerListViewProps): React.JSX.Element {
  const {
    actionError,
    currentPath,
    matchingProjects,
    mutationsDisabled,
    normalizedQuery,
    onPin,
    onSelect,
    pending,
    pinnedProjects,
    pinningPath,
    recentProjects,
  } = props;
  const selectDefault = useEvent(() => onSelect(null));
  const visibleProjects = normalizedQuery === "" ? pinnedProjects : matchingProjects;
  return (
    <PresentationSheetScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={styles.list}
    >
      <SectionLabel
        count={normalizedQuery === "" ? pinnedProjects.length : matchingProjects.length}
        title={normalizedQuery === "" ? "Pinned" : "Search results"}
      />
      {visibleProjects.map((project) => (
        <ProjectPickerRowView
          key={project.id}
          onPin={onPin}
          onSelect={onSelect}
          pinDisabled={mutationsDisabled || pending || pinningPath !== null}
          pinning={pinningPath === project.path}
          project={project}
          selectDisabled={pending || pinningPath !== null}
          selected={project.path === currentPath}
        />
      ))}
      {normalizedQuery === "" && recentProjects.length > 0 ? (
        <>
          <SectionLabel count={recentProjects.length} title="Recent" />
          {recentProjects.map((project) => (
            <ProjectPickerRowView
              key={project.id}
              onPin={onPin}
              onSelect={onSelect}
              pinDisabled={mutationsDisabled || pending || pinningPath !== null}
              pinning={pinningPath === project.path}
              project={project}
              selectDisabled={pending || pinningPath !== null}
              selected={project.path === currentPath}
            />
          ))}
        </>
      ) : null}
      {matchingProjects.length === 0 ? (
        <View style={styles.empty}>
          <PresentationIcon color={colors.textDim} name="search" size={24} />
          <ProductText tone="muted">No matching projects</ProductText>
        </View>
      ) : null}
      {actionError === null ? null : (
        <ProductText accessibilityLiveRegion="polite" style={styles.error} tone="danger">
          {actionError}
        </ProductText>
      )}
      {normalizedQuery === "" ? (
        <Pressable
          accessibilityLabel="Server default"
          accessibilityRole="button"
          accessibilityState={{ disabled: pending, selected: currentPath === null }}
          disabled={pending}
          onPress={selectDefault}
          style={currentPath === null ? selectedRowStyle : rowStyle}
        >
          <ProjectPickerCopy
            detail="Let Codex choose the working directory"
            icon="server"
            title="Server default"
          />
          <PresentationIcon
            color={currentPath === null ? colors.accent : colors.textDim}
            name={currentPath === null ? "checkCircle" : "radio"}
            size={20}
          />
        </Pressable>
      ) : null}
    </PresentationSheetScrollView>
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

function rowStyle(state: PressableStateCallbackType) {
  return [styles.row, state.pressed && styles.pressed];
}

function selectedRowStyle(state: PressableStateCallbackType) {
  return [styles.row, styles.rowSelected, state.pressed && styles.pressed];
}
