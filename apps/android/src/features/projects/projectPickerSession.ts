import { useId, useRef, useState } from "react";
import { useConversationOwner } from "../../ui/use-conversation-owner";
import type { ScrollView } from "react-native";
import { parentDirectoryPath } from "../../data/remote-projects";
import { useEvent } from "../../react/useEvent";
import type { ScopedProjectPickerProps, ProjectPickerChoice } from "./projectPickerContract";
import { useProjectPickerRows, type ProjectSectionId } from "./projectPickerRows";
import { useProjectDirectoryResource } from "./projectDirectoryResource";

import { canAddDirectory } from "./projectDirectorySelection";

import { useProjectPickerNavigation } from "./projectPickerNavigation";
import { directorySelectionPath } from "./projectDirectoryConfirmation";
/** Owns local picker navigation, qualified actions and expansion, independently of the sidebar filter. */
function usePickerSession(argumentsProps: ScopedProjectPickerProps) {
  const {
    busy,
    choices,
    initialConnectionId,
    onAddProject,
    onReadDirectory,
    onReadHomeDirectory,
    onSelect,
    servers,
    visible,
  } = argumentsProps;
  const [query, setQuery] = useState("");
  const validInitial = servers.some((server) => server.id === initialConnectionId)
    ? initialConnectionId
    : null;
  const onlyServer = servers.length === 1 ? (servers[0]?.id ?? null) : null;
  const [serverFilter, setServerFilter] = useState<string | null>(validInitial ?? onlyServer);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const navigation = useProjectPickerNavigation(argumentsProps, busy || adding);
  const { folderConnectionId, mode, navigationDirection, requestedDirectory } = navigation;
  const directoryServer = servers.find((server) => server.id === folderConnectionId) ?? null;
  const [pinningPath, setPinningPath] = useState<string | null>(null);
  const [projectActionError, setProjectActionError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<ReadonlySet<ProjectSectionId>>(
    () => new Set(["recent"]),
  );
  const pickerId = useId();
  const pickerOwner = useConversationOwner(pickerId);
  const breadcrumbScroll = useRef<ScrollView>(null);
  const scrollToCurrentFolder = useEvent(() =>
    breadcrumbScroll.current?.scrollToEnd({ animated: false }),
  );
  const { directory, directoryEntries, directoryLoading, directoryPath, home, readError } =
    useProjectDirectoryResource({
      connectionId: folderConnectionId,
      enabled: visible && mode === "directory" && directoryServer?.available === true,
      pickerId,
      props: { onReadDirectory, onReadHomeDirectory },
      requestedDirectory,
    });

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredChoices =
    serverFilter === null ? choices : choices.filter((choice) => choice.server.id === serverFilter);
  const { projectRows, unpinnedProjects } = useProjectPickerRows(
    filteredChoices,
    normalizedQuery,
    expandedSections,
  );

  if (normalizedQuery === "") {
    for (const server of servers) {
      if (serverFilter !== null && server.id !== serverFilter) {
        continue;
      }
      projectRows.push({
        available: server.available,
        connectionId: server.id,
        iconId: server.iconId,
        id: `server-default:${server.id}`,
        kind: "server-default",
        serverName: server.name,
      });
    }
  }
  const selectServer = useEvent((connectionId: string | null) => {
    if (!busy && !adding) {
      setServerFilter(connectionId);
    }
  });
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
    navigation.navigate(path);
    setDirectoryError(null);
  });
  const openDirectoryPicker = useEvent((connectionId: string | null) => {
    if (busy || adding) {
      return;
    }
    setQuery("");
    setDirectoryError(null);
    navigation.openDirectoryPicker(connectionId);
  });
  const showServers = useEvent(() => {
    setQuery("");
    setDirectoryError(null);
    navigation.showServers();
  });
  const showProjects = useEvent(() => {
    navigation.showProjects();
    setQuery("");
  });
  const runAddCurrentDirectory = useEvent(async () => {
    if (
      directoryServer === null ||
      !canAddDirectory({
        adding,
        busy,
        directoryPath,
        directoryServer,
        directoryStatus: directory.status,
        readError,
      })
    ) {
      return;
    }
    setAdding(true);
    setDirectoryError(null);
    try {
      const path = await directorySelectionPath(argumentsProps, directoryServer.id, directoryPath);
      if (!pickerOwner.isCurrent()) {
        return;
      }
      await onSelect({ connectionId: directoryServer.id, cwd: path });
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
  const pinProject = useEvent(async (choice: ProjectPickerChoice) => {
    if (onAddProject === undefined || pinningPath !== null || busy) {
      return;
    }
    setPinningPath(JSON.stringify([choice.server.id, choice.project.path]));
    setProjectActionError(null);
    try {
      await onAddProject(choice.server.id, choice.project.path);
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
    directoryServer,
    filteredChoices,
    folderConnectionId,
    home,
    isCurrent: pickerOwner.isCurrent,
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
    selectServer,
    serverFilter,
    setQuery,
    showProjects,
    showServers,
    toggleProjectSection,
    unpinnedProjects,
    visibleDirectories,
  };
}
/** Owns local picker navigation, qualified actions and expansion, independently of the sidebar filter. */
export function useProjectPickerSession(
  props: ScopedProjectPickerProps,
): ReturnType<typeof usePickerSession> {
  return usePickerSession(props);
}
/** State machine returned by the project-picker session hook. */
export type ProjectPickerSession = ReturnType<typeof usePickerSession>;
