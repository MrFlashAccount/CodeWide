import { Pressable } from "react-native";

import { ActionMenu, type ActionMenuItem } from "./ActionMenu";
import type { PermissionsMenuProps } from "./TurnControlMenus.types";

const SERVER_DEFAULT_PERMISSIONS = "permissions:server-default";

export { ModelThinkingSheet as ModelThinkingMenu } from "./ModelThinkingSheet.native";

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
