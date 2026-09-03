import type { V2Command, V2ThreadSettings } from "@codewide/sync-client/v2";

import type { QualifiedThread } from "../../domain/qualifiedThread";
import type { ComposerContextItem } from "../../presentation/input/ComposerContextStripView";
import {
  accessLabel,
  nextPermissionSelection,
  permissionMenuActions,
} from "../threadList/newThreadPermissionControls";

interface ConversationPermissionContextInput {
  actionable: boolean;
  onSelect(id: string): void;
  pending: boolean;
  settings: V2ThreadSettings | null;
}

export function conversationPermissionContextItem(
  input: ConversationPermissionContextInput,
): ComposerContextItem {
  if (input.settings === null) {
    return {
      icon: "shield",
      id: "permissions",
      label: "Access",
      loading: input.pending,
      menu: {
        accessibilityLabel: "Permissions: Access",
        actions: [
          {
            disabled: true,
            id: "permissions:unavailable",
            label: "Thread settings unavailable",
          },
        ],
        menuWidth: 344,
        onSelect: input.onSelect,
      },
    };
  }
  const label = accessLabel(input.settings);
  return {
    icon: "shield",
    id: "permissions",
    label,
    loading: input.pending,
    menu: {
      accessibilityLabel: `Permissions: ${label}`,
      actions: permissionMenuActions(input.settings, input.pending || !input.actionable),
      menuWidth: 344,
      onSelect: input.onSelect,
    },
  };
}

export function nextConversationPermissionSettings(
  id: string,
  settings: V2ThreadSettings | null,
): V2ThreadSettings | null {
  return settings === null ? null : nextPermissionSelection(id, settings);
}

export function threadSettingsUpdateCommand(
  owner: QualifiedThread,
  settings: V2ThreadSettings,
): V2Command {
  return {
    change: { kind: "settings", settings },
    kind: "thread.update",
    threadId: owner.threadId,
  };
}
