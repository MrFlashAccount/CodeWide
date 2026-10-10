import type { Personality } from "@codewide/codex-protocol/v0.155.1";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { ModelReasoningLevels } from "./modelEffort";

type ModelControl = ModelReasoningLevels & {
  id: string;
  label: string;
  /** Provider of a provider-aware catalog row (its mark); `null` or absent for a legacy catalog. */
  provider?: string | null;
  serviceTiers?: readonly { description: string; id: string; name: string }[];
  supportsPersonality: boolean;
};

export type ModelSettingsChoice = {
  /** `null` only for a model without thinking levels. */
  readonly effort: string | null;
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
  | {
      /** Opens the "Fork into" picker; absent when the thread cannot fork into another agent. */
      readonly forkIntoAgent: (() => void) | null;
      readonly kind: "thread";
      readonly providerName: string;
    };

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

/**
 * The "Server default" access option. In a new chat it is the absence of a
 * choice (`null`): the provider applies its default when the thread starts. An
 * existing thread has an effective profile, so the option sends the provider's
 * default profile id explicitly; it is disabled while that default is unknown.
 */
export type PermissionDefaultOption =
  | { readonly kind: "draft"; readonly resolved: string | null; readonly selected: boolean }
  | { readonly kind: "reset"; readonly resolved: string }
  | { readonly kind: "unavailable" };

export type PermissionsMenuProps = TriggerProps & {
  error: string | null;
  loading: boolean;
  /** `null` selects the new chat's default; a profile id selects that profile. */
  onSelectPermissions: (permissions: string | null) => void;
  permissions: readonly PermissionControl[];
  /** The selected explicit profile, `null` when none is. */
  selectedPermissions: string | null;
  serverDefault: PermissionDefaultOption;
};
