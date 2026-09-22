import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const screen = compactSource(readSource("../app/(workspace)/_layout.tsx"));
const workspace = readSource("../src/data/thread-sync-projection.ts");
const nativeTransport = readSource("../src/native/native-transport.native.ts");
const nativeModule = readSource(
  "../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt",
);
const commandStore = readSource(
  "../android/app/src/main/java/dev/codewide/app/remote/NativeCommandStore.kt",
);
const commandPolicy = readSource(
  "../android/app/src/main/java/dev/codewide/app/remote/NativeCommandPolicy.kt",
);
const connectionService = readSource(
  "../android/app/src/main/java/dev/codewide/app/remote/CodexConnectionService.kt",
);

const ownerOptimisticTurn = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/OptimisticTurn.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerUserMessageContent = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/UserMessageContent.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerTurnTimelineItem = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/TurnTimelineItem.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerTurnFooter = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/TurnFooter.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerTurnTimelineItemStyles = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/TurnTimelineItem.styles.ts", import.meta.url),
    "utf8",
  ),
);

const turnOwner = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/TurnTimelineItem.tsx", import.meta.url),
    "utf8",
  ),
);

const ownerCommandDelivery = readFileSync(
  new URL("../src/data/command-delivery.ts", import.meta.url),
  "utf8",
);
const ownerThreadSyncProjection = readFileSync(
  new URL("../src/data/thread-sync-projection.ts", import.meta.url),
  "utf8",
);

const userTurnBody = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/UserTurnBody.tsx", import.meta.url),
    "utf8",
  ),
);

describe("failed message retry", () => {
  it("requeues the original durable command instead of creating a duplicate message", () => {
    expect(commandStore).toContain("fun retryFailed(connectionId: String, commandId: String)");
    expect(commandStore).toContain("SET state = 'uncertain', last_error = NULL");
    expect(nativeModule).toContain(
      "fun engineRetryCommand(connectionId: String, commandId: String, promise: Promise)",
    );
    expect(nativeTransport).toMatch(
      /retryNativeCommand\(\s*connectionId: string,\s*commandId: string,?\s*\)/u,
    );
    expect(ownerCommandDelivery).toContain(
      "retryFailedMessage = async (connectionId: string, commandId: string)",
    );
  });

  it("retries an uncertain turn admission through the idempotent companion queue", () => {
    expect(commandPolicy).toContain('"turn/start" to NativeCommandReconciliation.IDEMPOTENT_RETRY');
    expect(connectionService).toContain(
      'return "companion/queue/put" to JSONObject().put("command", queued)',
    );
    expect(connectionService).toContain('.put("commandId", command.commandId)');
  });

  it("places Retry beside the failed status", () => {
    expect(ownerOptimisticTurn).toContain('accessibilityLabel="Retry message"');
    expect(ownerOptimisticTurn).toContain("<Text style={styles.retryMessageText}>Retry</Text>");
    expect(ownerOptimisticTurn).toContain("style={[styles.turnFooter, styles.turnFooterEnd]}");
  });

  it("keeps pending delivery feedback in the user text without reserving an absent footer", () => {
    expect(ownerOptimisticTurn).toContain(
      'const pending = !failed && item.status !== "appServerAccepted";',
    );
    expect(ownerOptimisticTurn).toContain("pendingText={pending}");
    expect(ownerUserMessageContent).toContain('testID="pending-user-message-shimmer"');
    expect(screen).not.toContain('testID="optimistic-turn-footer-spacer"');
    expect(ownerOptimisticTurn).toContain(
      "accessibilityLabel={`Message ${deliveryLabel.toLowerCase()}`} style={styles.userMessageRow}",
    );
  });

  it("distinguishes Companion transport acceptance from App Server delivery", () => {
    expect(screen).not.toContain('const delivered = item.status === "delivered";');
    expect(ownerOptimisticTurn).toContain('? "Checking delivery"');
    expect(ownerOptimisticTurn).toContain('? "Sent"');
    expect(ownerOptimisticTurn).toContain(': "Accepted by Companion"');
    expect(ownerOptimisticTurn).toContain('? "Sending to Companion"');
    expect(screen).not.toContain("Sent ·");
    expect(userTurnBody).toContain("{formatClockTime(turn.turn.startedAt)}");
  });

  it("repairs companion delivery acceptance without blocking live lifecycle projection", () => {
    const repairStart = workspace.indexOf("for (const threadId of deliveredReceiptThreads)");
    const repairEnd = workspace.indexOf("for (const rootThreadId of subagentRoots)", repairStart);
    const repairSource = workspace.slice(repairStart, repairEnd);
    expect(ownerThreadSyncProjection).toContain("hasAppServerAcceptedPendingDelivery(");
    expect(repairStart).toBeGreaterThanOrEqual(0);
    expect(repairEnd).toBeGreaterThan(repairStart);
    expect(repairSource).toMatch(/void sync\s*\.repairThreadProjection\(connectionId, threadId\)/u);
    expect(repairSource).not.toContain(
      "const repaired = await sync.repairThreadProjection(connectionId, threadId)",
    );
    expect(repairSource).toContain("Accepted message receipt repair returned no thread");
    expect(repairSource).toContain(
      "await reconcileDeliveredCommandReceipts(connectionId, [repaired.thread])",
    );
  });

  it("keeps delivery state on optimistic user messages and turn metadata under the agent message", () => {
    const turnStart = turnOwner.indexOf("function TurnTimelineItem(");
    const turnEnd = turnOwner.length;
    const turnSource = turnOwner.slice(turnStart, turnEnd);
    const userStart = turnSource.indexOf("{userBlocks.length > 0 && (");
    const agentStart = turnSource.indexOf('label="Agent message"');
    const userSource = turnSource.slice(userStart, agentStart);

    expect(turnStart).toBeGreaterThanOrEqual(0);
    expect(turnEnd).toBeGreaterThan(turnStart);
    expect(agentStart).toBeGreaterThan(userStart);
    expect(userSource).not.toContain("<TurnFooter");
    expect(turnSource.indexOf("<TurnFooter")).toBeGreaterThan(agentStart);
    expect(ownerOptimisticTurn).toContain('testID="optimistic-turn-footer"');
    expect(ownerOptimisticTurn).toContain("style={[styles.turnFooter, styles.turnFooterEnd]}");
    expect(ownerTurnFooter).toContain(
      "time={completedAt === null ? null : formatClockTime(completedAt)}",
    );
  });

  it("renders timestamps outside the narrower message bubbles", () => {
    expect(ownerTurnTimelineItemStyles).toContain("userMessageRow:");
    expect(ownerTurnTimelineItemStyles).toContain("agentMessageRow:");
    expect(readFileSync(new URL("../src/rendering/Bubble.tsx", import.meta.url), "utf8")).toContain(
      'maxWidth: "82%"',
    );
    expect(screen).not.toContain("bubbleTime:");
    expect(screen).not.toContain("agentReplyMeta:");
  });
});
