/** V1 turnContexts owner, extracted without changing interaction or resource lifetime. */
import type { TurnUsageProjection } from "@codewide/sync-client";
import { createContext } from "react";

export const ForceExpandCardsContext = createContext(false);

export const ActiveToolCallContext = createContext(false);

export const TurnActivityContentContext = createContext(false);

export const TurnUsageContext = createContext<TurnUsageProjection | null>(null);

export const ExpansionItemKeyContext = createContext("item");

export const ThreadCwdContext = createContext("/workspace");

export const SubagentNavigationContext = createContext<((threadId: string) => void) | null>(null);
