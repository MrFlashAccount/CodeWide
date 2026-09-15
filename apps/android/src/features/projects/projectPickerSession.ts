import { useEffect, useId, useRef, useState } from "react";
import { ScrollView } from "react-native";
import type { RemoteDirectoryEntry, RemoteProject } from "../../data/remote-projects";
import { normalizeDirectoryPath, parentDirectoryPath } from "../../data/remote-projects";
import { useEvent } from "../../react/useEvent";
import { useAsyncResource } from "../../rendering/async-resource-store";
import type { ProjectPickerProps } from "./projectPickerContract";
import { useProjectPickerRows, type ProjectSectionId } from "./projectPickerRows";

type PickerMode = "projects" | "directory";
export function useProjectPickerSession({
  visible,
  cwd,
  projects,
  discoveredProjects,
  busy,
  onSelect,
  onAddProject,
  onReadDirectory,
  onReadHomeDirectory,
  browseOnly = false,
}: ProjectPickerProps) {
  const [mode, setMode] = useState<PickerMode>(browseOnly ? "directory" : "projects");
  const [query, setQuery] = useState("");
  const initialDirectory =
    normalizeDirectoryPath(cwd) || projects[0]?.path || discoveredProjects[0]?.path || "/";
  const [requestedDirectory, setDirectoryPath] = useState<string | null>(
    onReadHomeDirectory === undefined ? initialDirectory : null,
  );
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pinningPath, setPinningPath] = useState<string | null>(null);
  const [projectActionError, setProjectActionError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<ReadonlySet<ProjectSectionId>>(
    () => new Set(["recent"]),
  );
  const wasVisible = useRef(false);
  const pickerId = useId();
  const breadcrumbScroll = useRef<ScrollView>(null);
  const scrollToCurrentFolder = useEvent(() =>
    breadcrumbScroll.current?.scrollToEnd({ animated: false }),
  );
  const readHome = useEvent(async () => {
    if (onReadHomeDirectory === undefined) throw new Error("Server home directory is unavailable");
    return await onReadHomeDirectory();
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

  useEffect(() => {
    if (visible && !wasVisible.current) {
      setMode(browseOnly ? "directory" : "projects");
      setQuery("");
      setDirectoryPath(onReadHomeDirectory === undefined ? initialDirectory : null);
      setDirectoryError(null);
      setAdding(false);
      setPinningPath(null);
      setProjectActionError(null);
      setExpandedSections(new Set(["recent"]));
    }
    wasVisible.current = visible;
  }, [browseOnly, initialDirectory, onReadHomeDirectory, visible]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const { unpinnedProjects, projectRows } = useProjectPickerRows(
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
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  });

  const navigate = useEvent((path: string | null) => {
    if (adding) return;
    setQuery("");
    setDirectoryPath(path);
    setDirectoryError(null);
  });
  const openDirectoryPicker = useEvent(() => {
    if (onReadDirectory === undefined || onAddProject === undefined) return;
    setQuery("");
    setDirectoryError(null);
    setDirectoryPath(onReadHomeDirectory === undefined ? initialDirectory : null);
    setMode("directory");
  });
  const addCurrentDirectory = useEvent(async () => {
    if (
      onAddProject === undefined ||
      adding ||
      busy ||
      directory.status !== "ready" ||
      directoryPath === ""
    )
      return;
    setAdding(true);
    setDirectoryError(null);
    try {
      const project = await onAddProject(directoryPath);
      await onSelect(project.path);
    } catch (cause) {
      setDirectoryError(cause instanceof Error ? cause.message : "Could not add project");
    }
    setAdding(false);
  });
  const pinProject = useEvent(async (project: RemoteProject) => {
    if (onAddProject === undefined || pinningPath !== null || busy) return;
    setPinningPath(project.path);
    setProjectActionError(null);
    try {
      await onAddProject(project.path);
    } catch (cause) {
      setProjectActionError(cause instanceof Error ? cause.message : "Could not pin project");
    }
    setPinningPath(null);
  });

  return {
    mode,
    setMode,
    query,
    setQuery,
    requestedDirectory,
    directoryError,
    adding,
    pinningPath,
    projectActionError,
    breadcrumbScroll,
    scrollToCurrentFolder,
    home,
    directoryPath,
    directory,
    readError,
    directoryLoading,
    normalizedQuery,
    unpinnedProjects,
    visibleDirectories,
    parentPath,
    toggleProjectSection,
    projectRows,
    navigate,
    openDirectoryPicker,
    addCurrentDirectory,
    pinProject,
  };
}
/** State machine returned by the project-picker session hook. */
export type ProjectPickerSession = ReturnType<typeof useProjectPickerSession>;
