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
export function useProjectManagement({ projects, servers, errors }: ProjectManagementProps) {
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
  const toggleRecent = useEvent(() => setRecentExpanded(!recentExpanded));
  const toggleOther = useEvent(() => setOtherExpanded(!otherExpanded));
  const sections: ProjectManagerSection[] = [
    { title: "Pinned", projects: pinned, expanded: true, onToggle: undefined },
    {
      title: "Recent",
      projects: discovered.slice(0, 8),
      expanded: recentExpanded,
      onToggle: toggleRecent,
    },
    {
      title: "Other",
      projects: discovered.slice(8),
      expanded: otherExpanded,
      onToggle: toggleOther,
    },
  ];
  const rows: ProjectManagerItem[] = [];
  if (choosingServer) {
    rows.push({
      kind: "section",
      key: "section:servers",
      section: { title: "Add on server", projects: [], expanded: true, onToggle: undefined },
    });
    for (const server of servers) rows.push({ kind: "server", key: `server:${server.id}`, server });
  }
  for (const section of sections) {
    if (section.projects.length === 0) continue;
    rows.push({ kind: "section", key: `section:${section.title}`, section });
    if (section.expanded) {
      for (const project of section.projects)
        rows.push({ kind: "project", key: project.key, project });
    }
  }
  if (projects.length === 0 && errors.length === 0) {
    rows.push({
      kind: "message",
      key: "empty",
      message: "Add a folder to pin your first project.",
      error: false,
    });
  }
  errors.forEach((message, index) =>
    rows.push({ kind: "message", key: `error:${index}`, message, error: true }),
  );
  if (error !== null)
    rows.push({ kind: "message", key: "action-error", message: error, error: true });
  const change = useEvent(async (project: SidebarProject, action: () => Promise<void>) => {
    if (pending !== null) return;
    setPending(project.key);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update pinned projects");
    }
    setPending(null);
  });
  return { pending, rowIconSize, choosingServer, setChoosingServer, pinned, rows, change };
}
export type ProjectManagementState = ReturnType<typeof useProjectManagement>;
