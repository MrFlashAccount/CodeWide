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

  it("does not describe an App Server accepted command as still sending", () => {
    expect(screen).toContain('const delivered = item.status === "delivered";');
    expect(screen).toContain('? "Sent"');
    expect(screen).toContain('styles.turnStatusCompleted');
  });

  it("refreshes the authoritative thread after companion delivery acceptance", () => {
    expect(workspace).toContain("hasAcceptedPendingDelivery(");
    expect(workspace).toContain("workspaceActions.readThread(connectionId, threadId)");
    expect(workspace).toContain("Could not reconcile an accepted message receipt");
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
