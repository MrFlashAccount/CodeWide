import type { Personality } from "@codewide/codex-protocol/v0.147.0";
import { Pressable } from "react-native";

import { ActionMenu, type ActionMenuItem } from "./ActionMenu";
import type {
  ModelThinkingMenuProps,
  PermissionsMenuProps,
} from "./TurnControlMenus.types";

const PERSONALITIES = ["friendly", "pragmatic", "none"] as const satisfies readonly Personality[];
const SERVER_DEFAULT_PERSONALITY = "personality:server-default";
const SERVER_DEFAULT_PERMISSIONS = "permissions:server-default";

export function ModelThinkingMenu({
  accessibilityLabel,
  triggerChildren,
  triggerStyle,
  models,
  loading,
  error,
  selectedModel,
  selectedEffort,
  selectedPersonality,
  onOpen,
  onClose,
  onSelectModel,
  onSelectEffort,
  onSelectPersonality,
}: ModelThinkingMenuProps) {
  const model = models.find((candidate) => candidate.id === selectedModel) ?? models[0];
  const effectiveModel = selectedModel ?? model?.id ?? null;
  const efforts = model === undefined
    ? []
    : model.efforts.length > 0
      ? model.efforts
      : [model.defaultEffort];
  const effectiveEffort = selectedEffort ?? model?.defaultEffort ?? null;
  const actions: ActionMenuItem[] = [
    ...(loading && models.length === 0
      ? [{ id: "model:loading", section: "Model", label: "Loading from remote server…", disabled: true }]
      : []),
    ...(error === null
      ? []
      : [{ id: "model:error", section: "Error", label: error, disabled: true, destructive: true }]),
    ...(models.length === 0 && !loading
      ? [{ id: "model:empty", section: "Model", label: "No models returned by the server", disabled: true }]
      : models.map((candidate) => ({
          id: `model:${candidate.id}`,
          section: "Model",
          label: candidate.label,
          selected: candidate.id === effectiveModel,
          keepOpen: true,
        }))),
    ...efforts.map((effort) => ({
      id: `effort:${effort}`,
      section: "Thinking level",
      label: thinkingEffortLabel(effort),
      selected: effort === effectiveEffort,
    })),
    ...(model?.supportsPersonality === true
      ? [
          {
            id: SERVER_DEFAULT_PERSONALITY,
            section: "Personality",
            label: "Server default",
            selected: selectedPersonality === null,
          },
          ...PERSONALITIES.map((personality) => ({
            id: `personality:${personality}`,
            section: "Personality",
            label: personality,
            selected: selectedPersonality === personality,
          })),
        ]
      : []),
  ];
  const select = (id: string) => {
    if (id.startsWith("model:")) {
      const candidate = models.find((item) => item.id === id.slice("model:".length));
      if (candidate === undefined) return;
      const nextEffort = candidate.efforts.includes(effectiveEffort ?? "")
        ? effectiveEffort ?? candidate.defaultEffort
        : candidate.defaultEffort;
      onSelectModel(candidate.id, nextEffort);
      return;
    }
    if (id.startsWith("effort:")) {
      onSelectEffort(id.slice("effort:".length));
      return;
    }
    if (id === SERVER_DEFAULT_PERSONALITY) {
      onSelectPersonality(null);
      return;
    }
    if (id.startsWith("personality:")) onSelectPersonality(id.slice("personality:".length) as Personality);
  };

  return (
    <ActionMenu
      accessibilityLabel={accessibilityLabel}
      actions={actions}
      menuWidth={344}
      placement="top"
      align="start"
      onOpenChange={(open) => { if (open) onOpen(); else onClose(); }}
      onSelect={select}
    >
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={triggerStyle}>
        {triggerChildren}
      </Pressable>
    </ActionMenu>
  );
}

export function PermissionsMenu({
  accessibilityLabel,
  triggerChildren,
  triggerStyle,
  permissions,
  loading,
  error,
  selectedPermissions,
  onOpen,
  onClose,
  onSelectPermissions,
}: PermissionsMenuProps) {
  const actions: ActionMenuItem[] = [
    ...(loading && permissions.length === 0
      ? [{ id: "permissions:loading", section: "Security permissions", label: "Loading from remote server…", disabled: true }]
      : []),
    ...(error === null
      ? []
      : [{ id: "permissions:error", section: "Error", label: error, disabled: true, destructive: true }]),
    {
      id: SERVER_DEFAULT_PERMISSIONS,
      section: "Security permissions",
      label: "Server default",
      description: "Use the server's configured access level",
      selected: selectedPermissions === null,
    },
    ...permissions.map((permission) => ({
      id: `permissions:${permission.id}`,
      section: "Security permissions",
      label: permissionLabel(permission.id),
      ...(permission.description === null ? {} : { description: permission.description }),
      disabled: !permission.allowed,
      selected: permission.id === selectedPermissions,
    })),
  ];

  return (
    <ActionMenu
      accessibilityLabel={accessibilityLabel}
      actions={actions}
      menuWidth={344}
      placement="top"
      align="start"
      onOpenChange={(open) => { if (open) onOpen(); else onClose(); }}
      onSelect={(id) => {
        if (id === SERVER_DEFAULT_PERMISSIONS) onSelectPermissions(null);
        else if (id.startsWith("permissions:")) onSelectPermissions(id.slice("permissions:".length));
      }}
    >
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={triggerStyle}>
        {triggerChildren}
      </Pressable>
    </ActionMenu>
  );
}

function permissionLabel(id: string): string {
  if (id === ":workspace") return "Workspace";
  if (id === ":read-only") return "Read only";
  if (id === ":full-access" || id === ":danger-full-access") return "Full access";
  return id.startsWith(":") ? id.slice(1).replaceAll("-", " ") : id;
}

function thinkingEffortLabel(effort: string): string {
  if (effort === "xhigh") return "Extra high";
  return effort.length === 0 ? effort : `${effort[0]!.toUpperCase()}${effort.slice(1)}`;
}
