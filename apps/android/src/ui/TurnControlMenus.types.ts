import type { Personality } from "@codewide/codex-protocol/v0.147.0";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export type ModelControl = {
  id: string;
  label: string;
  defaultEffort: string;
  efforts: string[];
  supportsPersonality: boolean;
};

export type PermissionControl = {
  id: string;
  description: string | null;
  allowed: boolean;
};

type TriggerProps = {
  accessibilityLabel: string;
  triggerChildren: ReactNode;
  triggerStyle: StyleProp<ViewStyle>;
  onOpen(): void;
  onClose(): void;
  onFallbackPress(): void;
};

export type ModelThinkingMenuProps = TriggerProps & {
  models: readonly ModelControl[];
  loading: boolean;
  error: string | null;
  selectedModel: string | null;
  selectedEffort: string | null;
  selectedPersonality: Personality | null;
  onSelectModel(model: string, effort: string): void;
  onSelectEffort(effort: string): void;
  onSelectPersonality(personality: Personality | null): void;
};

export type PermissionsMenuProps = TriggerProps & {
  permissions: readonly PermissionControl[];
  loading: boolean;
  error: string | null;
  selectedPermissions: string | null;
  onSelectPermissions(permissions: string | null): void;
};
