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

export interface UsagePopoverActionViewModel {
  description?: string;
  icon: PresentationIconName;
  id: string;
  label: string;
  onPress(): void;
}

interface UsageTurnViewModel {
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  costUsd: number | null;
  inputTokens: number;
  latestRequestTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  uncachedInputTokens: number;
}

interface UsageSessionBreakdownViewModel extends UsageSessionViewModel {
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningOutputTokens: number;
  uncachedInputTokens: number;
}

export interface UsageBreakdownViewModel {
  cacheHit: boolean | null;
  compactions: number | null;
  context: UsageContextViewModel | null;
  model: string | null;
  session: UsageSessionBreakdownViewModel;
  status: "final" | "live";
  turn: UsageTurnViewModel;
}

type LiveTurnPlanStepState = "completed" | "pending" | "running";

export interface LiveTurnPlanStepViewModel {
  id: string;
  state: LiveTurnPlanStepState;
  text: string;
}

export interface LiveTurnPlanViewModel {
  completedSteps: number;
  currentStep: LiveTurnPlanStepViewModel;
  explanation: string | null;
  id: string;
  steps: readonly LiveTurnPlanStepViewModel[];
}
