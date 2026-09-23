import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import { projectedActivityMetrics, type TurnUsageProjection } from "@codewide/sync-client";
import type { ReactElement, ReactNode } from "react";
import { TurnActivityMetricsContext, TurnUsageContext } from "./turnContexts";

/** Supplies server figures to all physical slices of the same immutable turn. */
export function TurnMetricsProvider({
  children,
  turn,
  usage,
}: {
  readonly children: ReactNode;
  readonly turn: Turn;
  readonly usage: TurnUsageProjection | null;
}): ReactElement {
  return (
    <TurnActivityMetricsContext.Provider value={projectedActivityMetrics(turn)}>
      <TurnUsageContext.Provider value={usage}>{children}</TurnUsageContext.Provider>
    </TurnActivityMetricsContext.Provider>
  );
}
