import type { ComponentProps, ReactNode } from "react";
import { Pressable } from "react-native";

import type { PresentationIconName } from "../icons/PresentationIcon";

export interface UsageAccountViewModel {
  active: boolean;
  detail: string;
  enabled: boolean;
  exhausted: boolean;
  id: string;
  label: string;
  limitState: "disabled" | "limitReached" | "ready" | "refreshRequired" | "unavailable";
  remainingPercent: number | null;
  resetAt: string | null;
  resetIn: string | null;
}

export interface UsageContextViewModel {
  availableTokens: number;
  model: string | null;
  percent: number;
  totalTokens: number;
  usedTokens: number;
}

export interface UsageSessionViewModel {
  compactions: number | null;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageMenuActionViewModel {
  description?: string;
  icon: PresentationIconName;
  id: string;
  label: string;
  onPress(): void;
}

interface UsageMenuViewProps {
  accounts?: readonly UsageAccountViewModel[];
  actions?: readonly UsageMenuActionViewModel[];
  align?: "center" | "end" | "start";
  children: ReactNode;
  context?: UsageContextViewModel | null;
  placement?: "bottom" | "left" | "right" | "top";
  session?: UsageSessionViewModel | null;
  triggerAccessibilityLabel: string;
  triggerStyle?: ComponentProps<typeof Pressable>["style"];
}

export function UsageMenuView(props: UsageMenuViewProps): React.JSX.Element {
  const { children, triggerAccessibilityLabel, triggerStyle } = props;
  return (
    <Pressable
      accessibilityLabel={triggerAccessibilityLabel}
      accessibilityRole="button"
      style={triggerStyle}
    >
      {children}
    </Pressable>
  );
}
