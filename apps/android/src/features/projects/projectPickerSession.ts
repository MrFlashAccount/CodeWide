import { useId, useRef, useState } from "react";
import type { ScrollView } from "react-native";
import type { RemoteDirectoryEntry, RemoteProject } from "../../data/remote-projects";
import { normalizeDirectoryPath, parentDirectoryPath } from "../../data/remote-projects";
import { useEvent } from "../../react/useEvent";
import { useAsyncResource } from "../../rendering/async-resource-store";
import type { ProjectPickerProps } from "./projectPickerContract";
import { useProjectPickerRows, type ProjectSectionId } from "./projectPickerRows";

type PickerMode = "projects" | "directory";
export function useProjectPickerSession({
  browseOnly = false,
  busy,
  cwd,
  discoveredProjects,
  onAddProject,
  onReadDirectory,
  onReadHomeDirectory,
  onSelect,
  projects,
  visible,
}: ProjectPickerProps) {
  const [mode, setMode] = useState<PickerMode>(browseOnly ? "directory" : "projects");
  const [navigationDirection, setNavigationDirection] = useState<"back" | "forward" | null>(null);
  const [query, setQuery] = useState("");
  const cwdDirectory = normalizeDirectoryPath(cwd);
  const initialDirectory =
    cwdDirectory !== "" ? cwdDirectory : (projects[0]?.path ?? discoveredProjects[0]?.path ?? "/");
  const [requestedDirectory, setRequestedDirectory] = useState<string | null>(
    onReadHomeDirectory === undefined ? initialDirectory : null,
  );
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pinningPath, setPinningPath] = useState<string | null>(null);
  const [projectActionError, setProjectActionError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<ReadonlySet<ProjectSectionId>>(
    () => new Set(["recent"]),
  );
  const pickerId = useId();
  const breadcrumbScroll = useRef<ScrollView>(null);
  const scrollToCurrentFolder = useEvent(() =>
    breadcrumbScroll.current?.scrollToEnd({ animated: false }),
  );
  const readHome = useEvent(async () => {
    if (onReadHomeDirectory === undefined) {
      throw new Error("Server home directory is unavailable");
    }
    return onReadHomeDirectory();
  });
  const home = useAsyncResource<string>(
    visible && mode === "directory" && onReadHomeDirectory !== undefined
      ? `${pickerId}:home`
      : null,
    0,
    readHome,
  );
  const directoryPath = requestedDirectory ?? home.value ?? "";
  const readDirectory = useEvent(async (path: string) => (await onReadDirectory?.(path)) ?? []);
  const directory = useAsyncResource<RemoteDirectoryEntry[]>(
    visible && mode === "directory" && directoryPath !== "" && onReadDirectory !== undefined
      ? `${pickerId}:${directoryPath}`
      : null,
    0,
    async () => {
      const entries = await readDirectory(directoryPath);
      return entries
        .filter((entry) => entry.isDirectory)
        .sort((left, right) =>
          left.fileName.localeCompare(right.fileName, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        );
    },
  );
  const directoryEntries = directory.value ?? [];
  const homeError = requestedDirectory === null ? home.error : null;
  const readError = homeError ?? directory.error;
  const directoryLoading =
    directory.status === "loading" || (requestedDirectory === null && home.status === "loading");

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const { projectRows, unpinnedProjects } = useProjectPickerRows(
    projects,
    discoveredProjects,
    normalizedQuery,
    expandedSections,
  );

  const visibleDirectories =
    normalizedQuery === ""
      ? directoryEntries
      : directoryEntries.filter((entry) =>
          entry.fileName.toLocaleLowerCase().includes(normalizedQuery),
        );
  const parentPath = parentDirectoryPath(directoryPath);
  const toggleProjectSection = useEvent((sectionId: ProjectSectionId) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  });

  const navigate = useEvent((path: string | null) => {
    if (adding) {
      return;
    }
    setQuery("");
    setRequestedDirectory(path);
    setDirectoryError(null);
  });
  const openDirectoryPicker = useEvent(() => {
    if (onReadDirectory === undefined || onAddProject === undefined) {
      return;
    }
    setQuery("");
    setDirectoryError(null);
    setRequestedDirectory(onReadHomeDirectory === undefined ? initialDirectory : null);
    setNavigationDirection("forward");
    setMode("directory");
  });
  const showProjects = useEvent(() => {
    setNavigationDirection("back");
    setMode("projects");
  });
  const runAddCurrentDirectory = useEvent(async () => {
    if (
      onAddProject === undefined ||
      adding ||
      busy ||
      directory.status !== "ready" ||
      directoryPath === ""
    ) {
      return;
    }
    setAdding(true);
    setDirectoryError(null);
    try {
      const project = await onAddProject(directoryPath);
      await onSelect(project.path);
    } catch (error) {
      setDirectoryError(error instanceof Error ? error.message : "Could not add project");
    }
    setAdding(false);
  });
  const addCurrentDirectory = useEvent(() => {
    runAddCurrentDirectory().catch((error: unknown) => {
      setAdding(false);
      setDirectoryError(error instanceof Error ? error.message : "Could not add project");
    });
  });
  const pinProject = useEvent(async (project: RemoteProject) => {
    if (onAddProject === undefined || pinningPath !== null || busy) {
      return;
    }
    setPinningPath(project.path);
    setProjectActionError(null);
    try {
      await onAddProject(project.path);
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : "Could not pin project");
    }
    setPinningPath(null);
  });

  return {
    addCurrentDirectory,
    adding,
    breadcrumbScroll,
    directory,
    directoryError,
    directoryLoading,
    directoryPath,
    home,
    mode,
    navigate,
    navigationDirection,
    normalizedQuery,
    openDirectoryPicker,
    parentPath,
    pinningPath,
    pinProject,
    projectActionError,
    projectRows,
    query,
    readError,
    requestedDirectory,
    scrollToCurrentFolder,
    setQuery,
    showProjects,
    toggleProjectSection,
    unpinnedProjects,
    visibleDirectories,
  };
}
/** State machine returned by the project-picker session hook. */
export type ProjectPickerSession = ReturnType<typeof useProjectPickerSession>;
