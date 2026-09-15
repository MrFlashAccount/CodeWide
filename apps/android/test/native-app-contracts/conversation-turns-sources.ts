import { readFileSync } from "node:fs";

export const ownerPreTurnLifecycleRows = readFileSync(
  new URL("../../src/features/conversation/turns/PreTurnLifecycleRows.tsx", import.meta.url),
  "utf8",
);
export const ownerTurnProjection = readFileSync(
  new URL("../../src/features/conversation/turns/turnProjection.ts", import.meta.url),
  "utf8",
);
export const ownerOptimisticTurn = readFileSync(
  new URL("../../src/features/conversation/turns/OptimisticTurn.tsx", import.meta.url),
  "utf8",
);
export const ownerTurnActivity = readFileSync(
  new URL("../../src/features/conversation/turns/TurnActivity.tsx", import.meta.url),
  "utf8",
);
export const ownerTurnActivityStyles = readFileSync(
  new URL("../../src/features/conversation/turns/TurnActivity.styles.ts", import.meta.url),
  "utf8",
);
export const ownerUserMessageContent = readFileSync(
  new URL("../../src/features/conversation/turns/UserMessageContent.tsx", import.meta.url),
  "utf8",
);
export const ownerCompletedTurnHistory = readFileSync(
  new URL("../../src/features/conversation/turns/CompletedTurnHistory.tsx", import.meta.url),
  "utf8",
);
export const ownerMessageActionRail = readFileSync(
  new URL("../../src/features/conversation/turns/MessageActionRail.tsx", import.meta.url),
  "utf8",
);
export const ownerTurnTimelineItem = readFileSync(
  new URL("../../src/features/conversation/turns/TurnTimelineItem.tsx", import.meta.url),
  "utf8",
);
export const ownerLiveAgentResponse = readFileSync(
  new URL("../../src/features/conversation/turns/LiveAgentResponse.tsx", import.meta.url),
  "utf8",
);
export const ownerDisclosureState = readFileSync(
  new URL("../../src/features/conversation/turns/disclosureState.ts", import.meta.url),
  "utf8",
);
export const ownerCard = readFileSync(
  new URL("../../src/features/conversation/turns/Card.tsx", import.meta.url),
  "utf8",
);
export const ownerTurnContexts = readFileSync(
  new URL("../../src/features/conversation/turns/turnContexts.tsx", import.meta.url),
  "utf8",
);
export const ownerLiveAgentResponseStyles = readFileSync(
  new URL("../../src/features/conversation/turns/LiveAgentResponse.styles.ts", import.meta.url),
  "utf8",
);
export const ownerTurnTimelineItemStyles = readFileSync(
  new URL("../../src/features/conversation/turns/TurnTimelineItem.styles.ts", import.meta.url),
  "utf8",
);
export const ownerUserMessageContentStyles = readFileSync(
  new URL("../../src/features/conversation/turns/UserMessageContent.styles.ts", import.meta.url),
  "utf8",
);
export const ownerTurnFooter = readFileSync(
  new URL("../../src/features/conversation/turns/TurnFooter.tsx", import.meta.url),
  "utf8",
);
