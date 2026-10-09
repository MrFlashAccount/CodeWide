import { useState } from "react";
import { useWindowDimensions } from "react-native";
import { useEvent } from "../../react/useEvent";
import { inlineIconMetrics } from "../../ui/inline-icon-metrics";
import type {
  ProjectManagementProps,
  ProjectManagerItem,
  ProjectManagerSection,
} from "./projectManagementContract";
import type { SidebarProject } from "./sidebarProjects";

function projectCatalogVersion(projects: readonly SidebarProject[]): string {
  let version = `${String(projects.length)};`;
  for (const project of projects) {
    version += `${String(project.key.length)}:${project.key}`;
    version += `${String(project.name.length)}:${project.name}`;
    version += `${String(project.subtitle.length)}:${project.subtitle}`;
    version += `${project.pinned ? "1" : "0"}:${String(project.lastUsedAt)};`;
  }
  return version;
}

export function useProjectManagement({
  errors,
  initialConnectionId,
  projects,
  servers,
}: ProjectManagementProps) {
  const [pending, setPending] = useState<string | null>(null);
  const { fontScale } = useWindowDimensions();
  const rowIconSize = inlineIconMetrics("body", fontScale).glyph;
  const [error, setError] = useState<string | null>(null);
  const [serverFilterId, setServerFilterId] = useState(
    initialConnectionId ?? (servers.length === 1 ? (servers[0]?.id ?? null) : null),
  );
  const selectedServer = servers.find((server) => server.id === serverFilterId) ?? null;
  const selectedServerId = selectedServer?.id ?? null;
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [otherExpanded, setOtherExpanded] = useState(false);
  const filteredProjects =
    selectedServerId === null
      ? projects
      : projects.filter((project) => project.connectionId === selectedServerId);
  const pinned = filteredProjects.filter((project) => project.pinned);
  const discovered = filteredProjects
    .filter((project) => !project.pinned)
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt);
  const toggleRecent = useEvent(() => {
    setRecentExpanded(!recentExpanded);
  });
  const toggleOther = useEvent(() => {
    setOtherExpanded(!otherExpanded);
  });
  const sections: ProjectManagerSection[] = [
    { expanded: true, onToggle: undefined, projects: pinned, title: "Pinned" },
    {
      expanded: recentExpanded,
      onToggle: toggleRecent,
      projects: discovered.slice(0, 8),
      title: "Recent",
    },
    {
      expanded: otherExpanded,
      onToggle: toggleOther,
      projects: discovered.slice(8),
      title: "Other",
    },
  ];
  const rows: ProjectManagerItem[] = [];
  for (const section of sections) {
    if (section.projects.length === 0) {
      continue;
    }
    rows.push({ key: `section:${section.title}`, kind: "section", section });
    if (section.expanded) {
      for (const project of section.projects) {
        rows.push({ key: project.key, kind: "project", project });
      }
    }
  }
  if (filteredProjects.length === 0 && errors.length === 0) {
    rows.push({
      error: false,
      key: "empty",
      kind: "message",
      message: "Add a folder to pin your first project.",
    });
  }
  errors.forEach((message, index) => {
    rows.push({ error: true, key: `error:${String(index)}`, kind: "message", message });
  });
  if (error !== null) {
    rows.push({ error: true, key: "action-error", kind: "message", message: error });
  }
  const change = useEvent((project: SidebarProject, action: () => Promise<void>): void => {
    if (pending !== null) {
      return;
    }
    setPending(project.key);
    setError(null);
    action().then(
      () => {
        setPending(null);
      },
      (error: unknown) => {
        setError(error instanceof Error ? error.message : "Could not update pinned projects");
        setPending(null);
      },
    );
  });
  return {
    change,
    dataVersion: projectCatalogVersion(filteredProjects),
    pending,
    pinned,
    rowIconSize,
    rows,
    selectedServer,
    selectedServerId,
    setSelectedServerId: setServerFilterId,
  };
}
export type ProjectManagementState = ReturnType<typeof useProjectManagement>;
