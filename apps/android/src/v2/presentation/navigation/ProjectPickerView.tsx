import { useState, useTransition } from "react";
import { Pressable, type PressableStateCallbackType, TextInput, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ShimmerText } from "../text/ShimmerText";
import { PresentationSheetView } from "../surfaces/PresentationSheetView";
import { ProductText } from "../text/ProductText";
import { ProjectPickerAddView } from "./ProjectPickerAddView";
import { ProjectPickerListView } from "./ProjectPickerListView";
import { projectPickerStyles as styles } from "./projectPickerStyles";

export interface ProjectPickerRow {
  id: string;
  label: string;
  path: string;
  pinned: boolean;
}

interface ProjectPickerViewProps {
  currentPath: string | null;
  isOpen: boolean;
  mutationsDisabled?: boolean;
  onAddProject(path: string): Promise<ProjectPickerRow>;
  onOpenChange(isOpen: boolean): void;
  onPinProject(project: ProjectPickerRow): Promise<void>;
  onSelect(path: string | null): Promise<void>;
  projects: readonly ProjectPickerRow[];
}

type ProjectPickerMode = "projects" | "add";

export function ProjectPickerView(props: ProjectPickerViewProps): React.JSX.Element {
  const {
    currentPath,
    isOpen,
    mutationsDisabled = false,
    onAddProject,
    onOpenChange,
    onPinProject,
    onSelect,
    projects,
  } = props;
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ProjectPickerMode>("projects");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pinningPath, setPinningPath] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingProjects =
    normalizedQuery === ""
      ? projects
      : projects.filter((project) =>
          `${project.label}\n${project.path}`.toLocaleLowerCase().includes(normalizedQuery),
        );
  const pinnedProjects = matchingProjects.filter((project) => project.pinned);
  const recentProjects = matchingProjects.filter((project) => !project.pinned);
  const select = useEvent((path: string | null): void => {
    if (pending) return;
    setActionError(null);
    startTransition(async () => {
      try {
        await onSelect(path);
        onOpenChange(false);
      } catch (cause: unknown) {
        setActionError(actionFailure(cause, "Could not open project."));
      }
    });
  });
  const add = useEvent((path: string): void => {
    if (pending || mutationsDisabled) return;
    setActionError(null);
    startTransition(async () => {
      try {
        const project = await onAddProject(path);
        await onSelect(project.path);
        onOpenChange(false);
      } catch (cause: unknown) {
        setActionError(actionFailure(cause, "Could not add project."));
      }
    });
  });
  const pin = useEvent((project: ProjectPickerRow): void => {
    if (pending || pinningPath !== null || mutationsDisabled) return;
    setActionError(null);
    setPinningPath(project.path);
    startTransition(() =>
      onPinProject(project).then(
        () => setPinningPath(null),
        (cause: unknown) => {
          setActionError(actionFailure(cause, "Could not pin project."));
          setPinningPath(null);
        },
      ),
    );
  });
  const close = useEvent(() => {
    setMode("projects");
    setQuery("");
    setActionError(null);
    onOpenChange(false);
  });
  const openAdd = useEvent(() => {
    if (pending || mutationsDisabled) return;
    setActionError(null);
    setMode("add");
  });
  const openProjects = useEvent(() => {
    setActionError(null);
    setMode("projects");
  });
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
        {mode === "add" ? (
          <Pressable
            accessibilityLabel="Back to projects"
            accessibilityRole="button"
            disabled={pending}
            onPress={openProjects}
            style={closeStyle}
          >
            <PresentationIcon color={colors.text} name="back" size={21} />
          </Pressable>
        ) : null}
        <View style={styles.headerCopy}>
          <ProductText style={styles.title} weight="semibold">
            {mode === "projects" ? "Choose project" : "Add project"}
          </ProductText>
          <ProductText numberOfLines={1} style={styles.subtitle} tone="muted">
            {mode === "projects"
              ? `${projects.filter((project) => project.pinned).length} pinned · ${projects.length} total`
              : "Choose a folder on this server"}
          </ProductText>
        </View>
        {pending ? <ShimmerText style={styles.pendingText} text="Opening…" /> : null}
        {mode === "projects" ? (
          <Pressable
            accessibilityLabel="Add project"
            accessibilityRole="button"
            accessibilityState={{ disabled: pending || mutationsDisabled }}
            disabled={pending || mutationsDisabled}
            onPress={openAdd}
            style={closeStyle}
          >
            <PresentationIcon color={colors.text} name="add" size={22} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel="Close project picker"
          accessibilityRole="button"
          onPress={close}
          style={closeStyle}
        >
          <PresentationIcon color={colors.text} name="close" size={21} />
        </Pressable>
      </View>
      {mode === "add" ? (
        <ProjectPickerAddView error={actionError} onAdd={add} pending={pending} />
      ) : (
        <>
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
          <ProjectPickerListView
            actionError={actionError}
            currentPath={currentPath}
            matchingProjects={matchingProjects}
            mutationsDisabled={mutationsDisabled}
            normalizedQuery={normalizedQuery}
            onPin={pin}
            onSelect={select}
            pending={pending}
            pinnedProjects={pinnedProjects}
            pinningPath={pinningPath}
            recentProjects={recentProjects}
          />
        </>
      )}
    </PresentationSheetView>
  );
}

function closeStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.close, pressed && styles.pressed];
}

function actionFailure(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
}
