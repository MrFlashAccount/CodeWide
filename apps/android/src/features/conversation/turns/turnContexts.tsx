/** V1 turnContexts owner, extracted without changing interaction or resource lifetime. */
import type { ActivityMetrics, TurnUsageProjection } from "@codewide/sync-client";
import { createContext } from "react";

export const ForceExpandCardsContext = createContext(false);

export const ActiveToolCallContext = createContext(false);

export const TurnActivityContentContext = createContext(false);

export const TurnUsageContext = createContext<TurnUsageProjection | null>(null);

export const ExpansionItemKeyContext = createContext("item");

export const ThreadCwdContext = createContext("/workspace");

export const SubagentNavigationContext = createContext<((threadId: string) => void) | null>(null);

export const TurnActivityMetricsContext = createContext<ActivityMetrics | null>(null);

export type TurnTarget = {
  readonly connectionId: string;
  readonly threadId: string;
  readonly turnId: string;
};

/** Qualifies an activity item with the exact resident turn that owns it. */
export const TurnTargetContext = createContext<TurnTarget | null>(null);

/** A background task a person can open: its id and the name to title it with. */
export type OpenableBackgroundTask = { readonly name: string; readonly taskId: string };

/**
 * Loads a background task's output and opens it in a dialog; `null` where the
 * thread cannot read task output. Resolves once the dialog shows.
 */
export const BackgroundTaskContext = createContext<
  ((task: OpenableBackgroundTask) => Promise<void>) | null
>(null);
