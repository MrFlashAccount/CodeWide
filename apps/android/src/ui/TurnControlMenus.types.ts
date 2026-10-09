import type { Personality } from "@codewide/codex-protocol/v0.155.1";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

type ModelControl = {
  defaultEffort: string;
  efforts: string[];
  id: string;
  label: string;
  /** Provider of a provider-aware catalog row (its mark); `null` or absent for a legacy catalog. */
  provider?: string | null;
  serviceTiers?: readonly { description: string; id: string; name: string }[];
  supportsPersonality: boolean;
};

export type ModelSettingsChoice = {
  readonly effort: string;
  readonly executionChanged: boolean;
  readonly model: string;
  readonly personality: Personality | null;
  readonly serviceTier: string | null | undefined;
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

/**
 * How the model picker explains the agent a conversation runs on, in
 * multi-provider mode only: a new chat groups models by provider and says the
 * agent is fixed once the chat starts; an existing thread names its agent.
 */
export type ModelAgentScope =
  | { readonly kind: "newChat" }
  | { readonly canFork: boolean; readonly kind: "thread"; readonly providerName: string };

export type ModelThinkingMenuProps = TriggerProps & {
  /** Absent on a single-provider or legacy server: the picker looks as before. */
  agentScope?: ModelAgentScope | null;
  error: string | null;
  loading: boolean;
  models: readonly ModelControl[];
  onApplySettings: (choice: ModelSettingsChoice) => void;
  selectedEffort: string | null;
  selectedModel: string | null;
  selectedPersonality: Personality | null;
  selectedServiceTier: string | null;
  showPersonalityControls?: boolean;
  showServiceTierControls?: boolean;
};

export type PermissionsMenuProps = TriggerProps & {
  error: string | null;
  loading: boolean;
  onSelectPermissions: (permissions: string | null) => void;
  permissions: readonly PermissionControl[];
  selectedPermissions: string | null;
};
