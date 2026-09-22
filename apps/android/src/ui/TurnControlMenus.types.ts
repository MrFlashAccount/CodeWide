import type { Personality } from "@codewide/codex-protocol/v0.155.1";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

type ModelControl = {
  defaultEffort: string;
  efforts: string[];
  id: string;
  label: string;
  supportsPersonality: boolean;
};

type PermissionControl = {
  allowed: boolean;
  description: string | null;
  id: string;
};

type TriggerProps = {
  accessibilityLabel: string;
  onClose: () => void;
  onFallbackPress: () => void;
  onOpen: () => void;
  triggerChildren: ReactNode;
  triggerStyle: StyleProp<ViewStyle>;
};

export type ModelThinkingMenuProps = TriggerProps & {
  error: string | null;
  loading: boolean;
  models: readonly ModelControl[];
  onSelectEffort: (effort: string) => void;
  onSelectModel: (model: string, effort: string) => void;
  onSelectPersonality: (personality: Personality | null) => void;
  selectedEffort: string | null;
  selectedModel: string | null;
  selectedPersonality: Personality | null;
};

export type PermissionsMenuProps = TriggerProps & {
  error: string | null;
  loading: boolean;
  onSelectPermissions: (permissions: string | null) => void;
  permissions: readonly PermissionControl[];
  selectedPermissions: string | null;
};
