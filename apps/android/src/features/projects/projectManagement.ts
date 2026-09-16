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

export function useProjectManagement({ errors, projects, servers }: ProjectManagementProps) {
  const [pending, setPending] = useState<string | null>(null);
  const { fontScale } = useWindowDimensions();
  const rowIconSize = inlineIconMetrics("body", fontScale).glyph;
  const [error, setError] = useState<string | null>(null);
  const [choosingServer, setChoosingServer] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [otherExpanded, setOtherExpanded] = useState(false);
  const pinned = projects.filter((project) => project.pinned);
  const discovered = projects
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
  if (choosingServer) {
    rows.push({
      key: "section:servers",
      kind: "section",
      section: { expanded: true, onToggle: undefined, projects: [], title: "Add on server" },
    });
    for (const server of servers) {
      rows.push({ key: `server:${server.id}`, kind: "server", server });
    }
  }
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
  if (projects.length === 0 && errors.length === 0) {
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
  return { change, choosingServer, pending, pinned, rowIconSize, rows, setChoosingServer };
}
export type ProjectManagementState = ReturnType<typeof useProjectManagement>;
