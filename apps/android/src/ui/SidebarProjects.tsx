import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { AppListRow } from "./AppListRow";
import { listRowHeight } from "./AppListRow.types";
import { useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";

import type { SidebarProject } from "../data/sidebar-projects";
import { colors, controlSize, iconSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { AppSheet, AppSheetScrollView } from "./AppSheet";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";
import { AppText as Text } from "./Typography";
import { threadListLayout } from "./thread-list-layout";
import { InlineIcon } from "./InlineIcon";
import { inlineIconMetrics } from "./inline-icon-metrics";

type ProjectManagerSection = {
  title: string;
  projects: readonly SidebarProject[];
  expanded: boolean;
  onToggle: (() => void) | undefined;
};

type ProjectManagerItem =
  | { kind: "section"; key: string; section: ProjectManagerSection }
  | { kind: "project"; key: string; project: SidebarProject }
  | { kind: "server"; key: string; server: { id: string; name: string } }
  | { kind: "message"; key: string; message: string; error: boolean };

const SECTION_HEIGHT = controlSize.touch + spacing.sm;

// Only exceptional/error copy is content-sized; ordinary rows never need measurement.
function projectManagerItemHeight(item: ProjectManagerItem): number | undefined {
  switch (item.kind) {
    case "section": return SECTION_HEIGHT;
    case "project": return listRowHeight.double;
    case "server": return listRowHeight.single;
    case "message": return undefined;
  }
}

function projectLocation(project: SidebarProject, serverName: string | undefined): string {
  const path = project.path;
  return serverName === undefined ? path : `${serverName} · ${path}`;
}

function projectActions(
  project: SidebarProject,
  pinned: readonly SidebarProject[],
  disabled: boolean,
): ActionMenuItem[] {
  const actions: ActionMenuItem[] = [
    {
      id: "pin",
      label: project.pinned ? "Unpin project" : "Pin project",
      icon: project.pinned ? "pin" : "pin-outline",
      disabled,
    },
  ];
  if (project.pinned) {
    actions.push(
      {
        id: "up",
        label: "Move up",
        icon: "arrow-up",
        disabled: disabled || pinned[0]?.key === project.key,
      },
      {
        id: "down",
        label: "Move down",
        icon: "arrow-down",
        disabled: disabled || pinned.at(-1)?.key === project.key,
      },
    );
  }
  return actions;
}

export function SidebarProjectRow({
  project,
  onPress,
}: {
  project: SidebarProject;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open project ${project.name}${project.serverLabel === null ? "" : `, ${project.serverLabel}`}${project.unread ? ", unread chats" : ""}`}
      accessibilityHint={project.path}
      onPress={onPress}
      style={({ pressed }) => [styles.project, styles.shortcut, pressed && styles.shortcutPressed]}
    >
      <InlineIcon name="folder-outline" role="body" color={colors.textMuted} />
      <View style={styles.shortcutIdentity}>
        <Text numberOfLines={1} style={styles.name}>
          {project.name}
        </Text>
        {project.serverLabel !== null && (
          <Text numberOfLines={1} style={styles.serverLabel}>{` · ${project.serverLabel}`}</Text>
        )}
      </View>
      <View style={styles.unreadSlot}>
        {project.unread && <View testID={`project-unread:${project.key}`} style={styles.unread} />}
      </View>
    </Pressable>
  );
}

export function SidebarProjectHeader({
  project,
  serverName,
  archived,
  onBack,
  onRoot,
}: {
  project: SidebarProject;
  serverName: string;
  archived: boolean;
  onBack(): void;
  onRoot(): void;
}) {
  return (
    <View testID="sidebar-project-breadcrumbs" style={styles.breadcrumbs}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={archived ? "Back to project chats" : "Back to projects"}
        style={styles.back}
        onPress={onBack}
      >
        <Ionicons name="arrow-back" size={iconSize.inline} color={colors.text} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Back to ${serverName} projects`}
        onPress={onRoot}
        style={styles.serverCrumb}
      >
        <Text numberOfLines={1} style={styles.crumbText}>
          {serverName}
        </Text>
      </Pressable>
      <Text style={styles.crumbSeparator}>{"\\"}</Text>
      <Text
        accessibilityLabel={`Project ${project.name}`}
        numberOfLines={1}
        style={[styles.crumbText, styles.projectCrumb]}
      >
        {project.name}
      </Text>
      {archived && (
        <Text numberOfLines={1} style={styles.archiveCrumb}>
          {"\\ Archive"}
        </Text>
      )}
    </View>
  );
}

export function SidebarProjectsSheet({
  projects,
  servers,
  errors,
  onToggle,
  onMove,
  onBrowse,
  onClose,
}: {
  projects: readonly SidebarProject[];
  servers: readonly { id: string; name: string }[];
  errors: readonly string[];
  onToggle(project: SidebarProject): Promise<void>;
  onMove(project: SidebarProject, direction: -1 | 1): Promise<void>;
  onBrowse(connectionId: string): void;
  onClose(): void;
}) {
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
  const sections: ProjectManagerSection[] = [
    { title: "Pinned", projects: pinned, expanded: true, onToggle: undefined },
    {
      title: "Recent",
      projects: discovered.slice(0, 8),
      expanded: recentExpanded,
      onToggle: () => setRecentExpanded(!recentExpanded),
    },
    {
      title: "Other",
      projects: discovered.slice(8),
      expanded: otherExpanded,
      onToggle: () => setOtherExpanded(!otherExpanded),
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
  const change = async (project: SidebarProject, action: () => Promise<void>) => {
    if (pending !== null) return;
    setPending(project.key);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update pinned projects");
    }
    setPending(null);
  };
  return (
    <AppSheet
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{
        dismissLabel: "Close project management",
        performanceSurface: "projects",
        snapPoints: ["62%", "92%"],
        enableDynamicSizing: false,
      }}
    >
      <View testID="project-management-header" style={styles.sheetHeader}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          Manage Projects
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add project"
          disabled={servers.length === 0 || pending !== null}
          style={({ pressed }) => [
            styles.headerAction,
            pressed && styles.shortcutPressed,
            (servers.length === 0 || pending !== null) && styles.disabled,
          ]}
          onPress={() => {
            const only = servers[0];
            if (servers.length === 1 && only !== undefined) onBrowse(only.id);
            else setChoosingServer(!choosingServer);
          }}
        >
          <Ionicons name="add" size={20} color={colors.text} />
        </Pressable>
      </View>
      <LegendList
        testID="project-management-list"
        style={styles.sheetList}
        contentContainerStyle={styles.sheetListContent}
        data={rows}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.kind}
        getFixedItemSize={projectManagerItemHeight}
        renderScrollComponent={AppSheetScrollView}
        drawDistance={320}
        recycleItems
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }) => {
          const previousSameKind = rows[index - 1]?.kind === item.kind;
          const nextSameKind = rows[index + 1]?.kind === item.kind;
          const position = previousSameKind ? nextSameKind ? "middle" : "last" : nextSameKind ? "first" : "only";
          if (item.kind === "message")
            return (
              <Text
                accessibilityRole={item.error ? "alert" : undefined}
                style={item.error ? styles.error : styles.empty}
              >
                {item.message}
              </Text>
            );
          if (item.kind === "server") {
            const { server } = item;
            return (
                <AppListRow title={server.name} position={position} fixedHeight={listRowHeight.single}
                  accessibilityLabel={`Add project on ${server.name}`}
                  onPress={() => {
                    setChoosingServer(false);
                    onBrowse(server.id);
                  }}
                  leadingIcon={{ name: "server-outline", size: rowIconSize, color: colors.textMuted }} />
            );
          }
          if (item.kind === "section") {
            const { section } = item;
            return (
              <View testID={`project-section:${section.title}`} style={styles.section}>
                {section.onToggle === undefined ? (
                  <View style={styles.sectionHeading}>
                      <Text numberOfLines={1} accessibilityRole="header" style={styles.sectionTitle}>
                      {section.title}
                    </Text>
                    {section.projects.length > 0 && (
                      <Text style={styles.sectionCount}>{section.projects.length}</Text>
                    )}
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${section.title} projects, ${section.projects.length}`}
                    accessibilityState={{ expanded: section.expanded }}
                    onPress={section.onToggle}
                    style={styles.sectionToggle}
                  >
                    <View style={styles.sectionHeading}>
                      <Text numberOfLines={1} style={styles.sectionTitle}>{section.title}</Text>
                      <Text style={styles.sectionCount}>{section.projects.length}</Text>
                    </View>
                    <View style={styles.menuSlot}>
                      <InlineIcon
                        name={section.expanded ? "chevron-down" : "chevron-forward"}
                        role="caption"
                        color={colors.textMuted}
                      />
                    </View>
                  </Pressable>
                )}
              </View>
            );
          }
          const { project } = item;
          return (
              <ActionMenu
                key={project.key}
                accessibilityLabel={`Actions for ${project.name}, ${project.subtitle}`}
                actions={projectActions(project, pinned, pending !== null)}
                onSelect={(id) => {
                  if (id === "pin") void change(project, () => onToggle(project));
                  else if (id === "up" || id === "down")
                    void change(project, () => onMove(project, id === "up" ? -1 : 1));
                }}
              >
                <AppListRow title={project.name} position={position} fixedHeight={listRowHeight.double} description={projectLocation(project, servers.length > 1 ? servers.find((server) => server.id === project.connectionId)?.name : undefined)}
                  accessibilityLabel={`Actions for ${project.name}, ${project.subtitle}`}
                  accessibilityHint="Pin or arrange this project"
                  disabled={pending !== null}
                  leadingIcon={{ name: "folder-outline", size: rowIconSize, color: colors.textMuted }}
                  {...(pending === project.key
                    ? { trailingBusy: true }
                    : { trailingIcon: { name: "ellipsis-horizontal", size: rowIconSize, color: colors.textMuted } })} />
              </ActionMenu>
          );
        }}
      />
    </AppSheet>
  );
}

const styles = StyleSheet.create({
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: controlSize.touch,
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  headerAction: {
    width: controlSize.touch,
    height: controlSize.touch,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetList: { flex: 1 },
  sheetListContent: { paddingBottom: spacing.md },
  section: { height: SECTION_HEIGHT, paddingTop: spacing.sm, justifyContent: "center" },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  sectionToggle: {
    height: controlSize.touch,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    paddingVertical: spacing.sm,
  },
  sectionCount: { color: colors.textDim, ...typeScale.caption },
  menuSlot: { minWidth: controlSize.touch, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.35 },
  project: {
    minHeight: controlSize.touch,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  shortcut: {
    height: threadListLayout.projectRowHeight,
    marginHorizontal: threadListLayout.edgeInset,
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
  },
  shortcutIdentity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline" },
  shortcutPressed: { opacity: 0.68 },
  serverLabel: { maxWidth: "45%", flexShrink: 1, color: colors.textMuted, ...typeScale.label },
  identity: { flex: 1, minWidth: 0 },
  name: { flexShrink: 1, color: colors.text, ...typeScale.body, fontWeight: typeWeight.semibold },
  subtitle: { color: colors.textMuted, ...typeScale.caption },
  unreadSlot: { width: spacing.sm, alignItems: "center" },
  unread: {
    width: spacing.xs,
    height: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.text,
  },
  breadcrumbs: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  serverCrumb: {
    maxWidth: "35%",
    flexShrink: 1,
    minHeight: controlSize.touch,
    justifyContent: "center",
  },
  crumbText: { color: colors.text, ...typeScale.title },
  crumbSeparator: { color: colors.textMuted, ...typeScale.body },
  projectCrumb: { flex: 1, minWidth: 0 },
  archiveCrumb: { color: colors.textMuted, ...typeScale.caption, flexShrink: 0 },
  back: {
    minWidth: controlSize.touch,
    minHeight: controlSize.touch,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    flex: 1,
    color: colors.text,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
  empty: { color: colors.textMuted, ...typeScale.body, paddingVertical: spacing.md },
  error: { color: colors.red, ...typeScale.body, paddingVertical: spacing.sm },
});
