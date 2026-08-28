import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const screen = readSource("../src/CodeWideScreen.tsx");
const workspace = readSource("../src/data/use-remote-workspace.ts");
const nativeTransport = readSource("../src/native/native-transport.native.ts");
const nativeModule = readSource("../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt");
const commandStore = readSource("../android/app/src/main/java/dev/codewide/app/remote/NativeCommandStore.kt");
const commandPolicy = readSource("../android/app/src/main/java/dev/codewide/app/remote/NativeCommandPolicy.kt");
const connectionService = readSource("../android/app/src/main/java/dev/codewide/app/remote/CodexConnectionService.kt");

describe("failed message retry", () => {
  it("requeues the original durable command instead of creating a duplicate message", () => {
    expect(commandStore).toContain("fun retryFailed(connectionId: String, commandId: String)");
    expect(commandStore).toContain("SET state = 'uncertain', last_error = NULL");
    expect(nativeModule).toContain("fun engineRetryCommand(connectionId: String, commandId: String, promise: Promise)");
    expect(nativeTransport).toContain("retryNativeCommand(connectionId: string, commandId: string)");
    expect(workspace).toContain("retryFailedMessage = async (connectionId: string, commandId: string)");
  });

  it("retries an uncertain turn admission through the idempotent companion queue", () => {
    expect(commandPolicy).toContain('"turn/start" to NativeCommandReconciliation.IDEMPOTENT_RETRY');
    expect(connectionService).toContain('return "companion/queue/put" to JSONObject().put("command", queued)');
    expect(connectionService).toContain('.put("commandId", command.commandId)');
  });

  it("places Retry beside the failed status", () => {
    expect(screen).toContain('accessibilityLabel="Retry message"');
    expect(screen).toContain('<Text style={styles.retryMessageText}>Retry</Text>');
    expect(screen).toContain("style={[styles.turnFooter, styles.turnFooterEnd]}");
  });

  it("does not describe transport acceptance as canonical delivery", () => {
    expect(screen).not.toContain('const delivered = item.status === "delivered";');
    expect(screen).not.toContain('? "Sent"');
    expect(screen).toContain('? "Checking delivery"');
    expect(screen).toContain('? "Running"');
    expect(screen).toContain(': "Accepted by Companion"');
    expect(screen).toContain('? "Sending to Companion"');
    expect(screen).toContain('`Sent · ${formatClockTime(rawTurn.startedAt)}`');
  });

  it("repairs companion delivery acceptance without blocking live lifecycle projection", () => {
    const repairStart = workspace.indexOf("for (const threadId of deliveredReceiptThreads)");
    const repairEnd = workspace.indexOf("for (const rootThreadId of subagentRoots)", repairStart);
    const repairSource = workspace.slice(repairStart, repairEnd);
    expect(workspace).toContain("hasAppServerAcceptedPendingDelivery(");
    expect(repairStart).toBeGreaterThanOrEqual(0);
    expect(repairEnd).toBeGreaterThan(repairStart);
    expect(repairSource).toContain("void workspaceActions.repairThreadProjection(connectionId, threadId)");
    expect(repairSource).not.toContain("const repaired = await workspaceActions.repairThreadProjection(connectionId, threadId)");
    expect(repairSource).toContain("Accepted message receipt repair returned no thread");
    expect(repairSource).toContain("await reconcileDeliveredCommandReceipts(connectionId, [repaired.thread])");
  });

  it("keeps delivery state on optimistic user messages and turn metadata under the agent message", () => {
    const turnStart = screen.indexOf("function TurnTimelineItem(");
    const turnEnd = screen.indexOf('type LiveContentMode = "markdown" | "code";');
    const turnSource = screen.slice(turnStart, turnEnd);
    const userStart = turnSource.indexOf("{userBlocks.length > 0 && (");
    const agentStart = turnSource.indexOf("{showAgentBubble && (");
    const userSource = turnSource.slice(userStart, agentStart);

    expect(turnStart).toBeGreaterThanOrEqual(0);
    expect(turnEnd).toBeGreaterThan(turnStart);
    expect(userSource).not.toContain("<TurnFooter");
    expect(turnSource.indexOf("<TurnFooter")).toBeGreaterThan(agentStart);
    expect(screen).toContain('testID="optimistic-turn-footer"');
    expect(screen).toContain('style={[styles.turnFooter, styles.turnFooterEnd]}');
    expect(screen).toContain('style={styles.turnFooter}');
  });

  it("renders timestamps outside the narrower message bubbles", () => {
    expect(screen).toContain("userMessageRow:");
    expect(screen).toContain("agentMessageRow:");
    expect(screen).toContain('maxWidth: "82%"');
    expect(screen).not.toContain("bubbleTime:");
    expect(screen).not.toContain("agentReplyMeta:");
  });
});
