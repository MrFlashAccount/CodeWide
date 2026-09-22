import type { Personality } from "@codewide/codex-protocol/v0.155.1";
import { Pressable } from "react-native";

import { ActionMenu, type ActionMenuItem } from "./ActionMenu";
import type { ModelThinkingMenuProps, PermissionsMenuProps } from "./TurnControlMenus.types";

const PERSONALITIES = ["friendly", "pragmatic", "none"] as const satisfies readonly Personality[];
const SERVER_DEFAULT_PERSONALITY = "personality:server-default";
const SERVER_DEFAULT_PERMISSIONS = "permissions:server-default";

export function ModelThinkingMenu({
  accessibilityLabel,
  error,
  loading,
  models,
  onClose,
  onOpen,
  onSelectEffort,
  onSelectModel,
  onSelectPersonality,
  selectedEffort,
  selectedModel,
  selectedPersonality,
  triggerChildren,
  triggerStyle,
}: ModelThinkingMenuProps) {
  const model = models.find((candidate) => candidate.id === selectedModel);
  const effectiveModel = selectedModel;
  const efforts =
    model === undefined ? [] : model.efforts.length > 0 ? model.efforts : [model.defaultEffort];
  const effectiveEffort = selectedEffort;
  const actions: ActionMenuItem[] = [
    ...(loading && models.length === 0
      ? [
          {
            disabled: true,
            id: "model:loading",
            label: "Loading from remote server…",
            section: "Model",
          },
        ]
      : []),
    ...(error === null
      ? []
      : [{ destructive: true, disabled: true, id: "model:error", label: error, section: "Error" }]),
    ...(models.length === 0 && !loading
      ? [
          {
            disabled: true,
            id: "model:empty",
            label: "No models returned by the server",
            section: "Model",
          },
        ]
      : models.map((candidate) => ({
          id: `model:${candidate.id}`,
          keepOpen: true,
          label: candidate.label,
          section: "Model",
          selected: candidate.id === effectiveModel,
        }))),
    ...efforts.map((effort) => ({
      id: `effort:${effort}`,
      label: thinkingEffortLabel(effort),
      section: "Thinking level",
      selected: effort === effectiveEffort,
    })),
    ...(model?.supportsPersonality === true
      ? [
          {
            id: SERVER_DEFAULT_PERSONALITY,
            label: "Server default",
            section: "Personality",
            selected: selectedPersonality === null,
          },
          ...PERSONALITIES.map((personality) => ({
            id: `personality:${personality}`,
            label: personality,
            section: "Personality",
            selected: selectedPersonality === personality,
          })),
        ]
      : []),
  ];
  const select = (id: string) => {
    if (id.startsWith("model:")) {
      const candidate = models.find((item) => item.id === id.slice("model:".length));
      if (candidate === undefined) {
        return;
      }
      const nextEffort = candidate.efforts.includes(effectiveEffort ?? "")
        ? (effectiveEffort ?? candidate.defaultEffort)
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
    if (id.startsWith("personality:")) {
      const personality = id.slice("personality:".length);
      if (isPersonality(personality)) {
        onSelectPersonality(personality);
      }
    }
  };

  return (
    <ActionMenu
      accessibilityLabel={accessibilityLabel}
      actions={actions}
      align="start"
      menuWidth={344}
      onOpenChange={(open) => {
        if (open) {
          onOpen();
        } else {
          onClose();
        }
      }}
      onSelect={select}
      placement="top"
    >
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        style={triggerStyle}
      >
        {triggerChildren}
      </Pressable>
    </ActionMenu>
  );
}

function isPersonality(value: string): value is Personality {
  return value === "friendly" || value === "pragmatic" || value === "none";
}

export function PermissionsMenu({
  accessibilityLabel,
  error,
  loading,
  onClose,
  onOpen,
  onSelectPermissions,
  permissions,
  selectedPermissions,
  triggerChildren,
  triggerStyle,
}: PermissionsMenuProps) {
  const actions: ActionMenuItem[] = [
    ...(loading && permissions.length === 0
      ? [
          {
            disabled: true,
            id: "permissions:loading",
            label: "Loading from remote server…",
            section: "Security permissions",
          },
        ]
      : []),
    ...(error === null
      ? []
      : [
          {
            destructive: true,
            disabled: true,
            id: "permissions:error",
            label: error,
            section: "Error",
          },
        ]),
    {
      description: "Use the server's configured access level",
      id: SERVER_DEFAULT_PERMISSIONS,
      label: "Server default",
      section: "Security permissions",
      selected: selectedPermissions === null,
    },
    ...permissions.map((permission) => ({
      id: `permissions:${permission.id}`,
      label: permissionLabel(permission.id),
      section: "Security permissions",
      ...(permission.description === null ? {} : { description: permission.description }),
      disabled: !permission.allowed,
      selected: permission.id === selectedPermissions,
    })),
  ];

  return (
    <ActionMenu
      accessibilityLabel={accessibilityLabel}
      actions={actions}
      align="start"
      menuWidth={344}
      onOpenChange={(open) => {
        if (open) {
          onOpen();
        } else {
          onClose();
        }
      }}
      onSelect={(id) => {
        if (id === SERVER_DEFAULT_PERMISSIONS) {
          onSelectPermissions(null);
        } else if (id.startsWith("permissions:")) {
          onSelectPermissions(id.slice("permissions:".length));
        }
      }}
      placement="top"
    >
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        style={triggerStyle}
      >
        {triggerChildren}
      </Pressable>
    </ActionMenu>
  );
}

function permissionLabel(id: string): string {
  if (id === ":workspace") {
    return "Workspace";
  }
  if (id === ":read-only") {
    return "Read only";
  }
  if (id === ":full-access" || id === ":danger-full-access") {
    return "Full access";
  }
  return id.startsWith(":") ? id.slice(1).replaceAll("-", " ") : id;
}

function thinkingEffortLabel(effort: string): string {
  if (effort === "xhigh") {
    return "Extra high";
  }
  return effort.length === 0 ? effort : `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}
