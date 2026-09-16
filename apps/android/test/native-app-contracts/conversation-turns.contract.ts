import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sourceHasJsxElement } from "../source-contract";
import { sourceObjectDeclaration } from "../source-contract";
import {
  ownerOptimisticTurn,
  ownerPreTurnLifecycleRows,
  ownerTurnProjection,
  ownerTurnActivity,
  ownerTurnActivityStyles,
  ownerUserMessageContent,
  ownerCompletedTurnHistory,
  ownerTurnTimelineItem,
  ownerMessageActionRail,
  ownerLiveAgentResponse,
  ownerDisclosureState,
  ownerCard,
  ownerTurnContexts,
  ownerLiveAgentResponseStyles,
  ownerUserMessageContentStyles,
  ownerTurnTimelineItemStyles,
} from "./conversation-turns-sources";

const ownerAgentTurnBody = readFileSync(
  new URL("../../src/features/conversation/turns/AgentTurnBody.tsx", import.meta.url),
  "utf8",
);
const ownerUserTurnBody = readFileSync(
  new URL("../../src/features/conversation/turns/UserTurnBody.tsx", import.meta.url),
  "utf8",
);

it("preserves conversation turns integration contracts", () => {
  expect(ownerOptimisticTurn).toContain('? "Running"');
  expect(ownerPreTurnLifecycleRows).toContain('testID="pre-turn-lifecycle"');
  expect(ownerTurnProjection).toContain("preTurnActivityIndexes");
  expect(ownerOptimisticTurn).toContain(': "Accepted by Companion"');
  expect(ownerOptimisticTurn).toContain(
    "accessibilityLabel={`Message ${deliveryLabel.toLowerCase()}`}",
  );
  expect(
    sourceHasJsxElement(ownerTurnActivity, "View", [
      'testID="turn-activity"',
      "styles.turnActivity",
      "compactHeader && styles.turnActivityCompact",
      "expanded && styles.turnActivityExpanded",
    ]),
  ).toBe(true);
  expect(ownerTurnActivity).toContain("showToggle={!shouldAutoExpand}");
  expect(ownerTurnActivity).toContain("{showToggle && (");
  expect(ownerTurnActivity).toMatch(
    /style=\{\[\s*styles\.turnActivityList,\s*!showToggle && styles\.turnActivityListWithoutToggle,?\s*\]\}/u,
  );
  expect(ownerTurnActivityStyles).toMatch(
    /turnActivityListWithoutToggle: \{\s*paddingLeft: 0,?\s*\}/u,
  );
  expect(ownerTurnActivity).toContain('testID="turn-activity-loading-shimmer"');
  expect(ownerTurnActivity).toContain("{expanded && (");
  expect(ownerTurnActivityStyles).toMatch(/turnActivityExpanded: \{[^}]*width: "100%"/u);
  expect(ownerTurnProjection).toContain("normalizeThreadItem(connectionId(row.connectionId)");
  expect(ownerUserMessageContent).toContain('testID="user-image-gallery"');
  expect(ownerUserMessageContent).toContain("text={normalized.text}");
  expect(ownerUserMessageContent).toContain("normalizeUserMessage(part.text)");
  expect(ownerUserMessageContent).toContain("<RichMarkdown\n          source={text}");
  expect(ownerOptimisticTurn).toContain('testID="optimistic-turn-footer"');
  expect(ownerOptimisticTurn).toContain("const deliveryLabel = failed");
  expect(ownerOptimisticTurn).toContain('? "Checking delivery"');
  expect(ownerOptimisticTurn).toContain('? "Sending to Companion"');
  expect(ownerOptimisticTurn).toContain(': "Queued";');
  expect(ownerOptimisticTurn).toContain("`Message was rejected: ${item.lastError}`");
  expect(ownerCompletedTurnHistory).toContain("function CompletedTurnHistory");
  expect(ownerCompletedTurnHistory).toContain("function CollapsedTurnActivity");
  expect(ownerTurnProjection).toContain("selectTurnRenderWindow(rawTurn)");
  expect(ownerTurnProjection).toContain("renderWindow.liveActivityIndexes.flatMap");
  expect(ownerTurnProjection).toContain(
    "activeTurnSequence(liveActivityEntries, renderWindow.collapsedActivityIndexes)",
  );
  expect(ownerTurnTimelineItem).toContain('rawTurn.status === "inProgress"');
  expect(ownerMessageActionRail).toContain('accessibilityLabel="Message actions"');
  expect(ownerTurnTimelineItem).toMatch(/<MessageActionRail\s+request=\{\{/);
  expect(
    sourceHasJsxElement(ownerLiveAgentResponse, "AppendOnlyLiveContent", [
      "animateNew={animateNew}",
      "cacheKey={cacheKey}",
      "fill={fill}",
      'mode="markdown"',
      "markdownProjection={projection}",
      "source={projection.source}",
      "streamMetricKey={streamMetricKey}",
    ]),
  ).toBe(true);
  expect(ownerLiveAgentResponse).toContain(
    'mode === "markdown" ? "live-agent-response" : "live-tool-output"',
  );
  expect(ownerLiveAgentResponse).toContain('const singleMarkdownTree = mode === "markdown";');
  expect(ownerTurnProjection).toMatch(
    /const visibleLiveActivitySequence =\s*liveActivitySequence\.map\(\(part\) => \{/,
  );
  expect(ownerAgentTurnBody).toContain(
    "projection={liveMarkdownProjection(presentation, part.block.key)}",
  );
  expect(ownerAgentTurnBody).toContain("if (projection === undefined)");
  expect(ownerDisclosureState).toContain(
    "const persistentExpansionStates = new Map<string, boolean>()",
  );
  expect(ownerDisclosureState).toMatch(/const PERSISTENT_EXPANSION_STATE_LIMIT = 4_?096/u);
  expect(ownerCard).toContain("writePersistentExpansionState(localKey, resolved)");
  expect(ownerTurnTimelineItem).toContain("function TurnTimelineItem({");
  expect(ownerTurnActivity).toMatch(/const thinkingOnly =\s*part\.blocks\.length > 0/);
  expect(ownerTurnActivity).toContain('testID="thinking-status-section"');
  expect(ownerTurnContexts).toContain("const TurnActivityContentContext = createContext(false);");
  expect(ownerTurnActivity).toContain("<TurnActivityContentContext.Provider value>");
  const thinkingStatusSection = sourceObjectDeclaration(
    ownerTurnActivityStyles,
    "thinkingStatusSection",
  );
  expect(thinkingStatusSection).toContain('alignItems: "flex-start"');
  expect(thinkingStatusSection).toContain('alignSelf: "flex-start"');
  expect(thinkingStatusSection).toContain('maxWidth: "100%"');
  expect(thinkingStatusSection).toContain("minWidth: 0");
  expect(
    sourceHasJsxElement(ownerTurnTimelineItem, "Bubble", [
      "fill={presentation.agentBubbleFill}",
      'variant="agent"',
      'testID="codex-bubble"',
      "errorContext={`Thread: ${turn.threadId}\\nTurn: ${turn.id}`}",
    ]),
  ).toBe(true);
  expect(
    sourceHasJsxElement(ownerUserTurnBody, "Bubble", ['testID="user-bubble"', 'variant="user"']),
  ).toBe(true);
  expect(ownerUserTurnBody).toContain("errorResetKey={`${turn.key}:user`}");
  expect(
    sourceHasJsxElement(ownerUserTurnBody, "SearchMessage", [
      "itemId={block.raw.id}",
      "key={block.key}",
    ]),
  ).toBe(true);
  expect(ownerUserTurnBody).toContain("<View style={styles.userMessageBlock}>");
  expect(ownerTurnProjection).toMatch(
    /richMarkdownLayout\(latestAgentBlock\??\.body \?\? ""\) === "fill"/u,
  );
  const liveAgentResponseStyle = sourceObjectDeclaration(
    ownerLiveAgentResponseStyles,
    "liveAgentResponse",
  );
  expect(liveAgentResponseStyle).toContain("minWidth: 0");
  expect(liveAgentResponseStyle).toContain('maxWidth: "100%"');
  expect(liveAgentResponseStyle).toContain('alignSelf: "flex-start"');
  const liveAgentResponseFillStyle = sourceObjectDeclaration(
    ownerLiveAgentResponseStyles,
    "liveAgentResponseFill",
  );
  expect(liveAgentResponseFillStyle).toContain('width: "100%"');
  expect(liveAgentResponseFillStyle).toContain('alignSelf: "stretch"');
  const userMessageContentStyle = sourceObjectDeclaration(
    ownerUserMessageContentStyles,
    "userMessageContent",
  );
  expect(userMessageContentStyle).toContain("minWidth: 0");
  expect(userMessageContentStyle).toContain("gap: spacing.compact");
  expect(sourceObjectDeclaration(ownerTurnTimelineItemStyles, "userMessageBlock")).toContain(
    "minWidth: 0",
  );
  expect(sourceObjectDeclaration(ownerUserMessageContentStyles, "userMessageTextBlock")).toContain(
    "minWidth: 0",
  );
  expect(ownerTurnTimelineItem).toContain("style={styles.agentMessageRow}");
  expect(ownerTurnActivity).toContain("expanded={visiblyExpanded}");
});
