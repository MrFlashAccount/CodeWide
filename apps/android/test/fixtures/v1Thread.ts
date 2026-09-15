import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";

/** A complete current V1 wire fixture; callers choose only the semantic history under test. */
export function createV1TestThread(id: string, parentThreadId: string | null, createdAt: number, turns: Turn[]): Thread {
  return {
    id, extra: null, sessionId: "test-session", forkedFromId: null, parentThreadId,
    preview: "", ephemeral: false, section: null, sectionEnteredAt: null,
    historyMode: "paginated", modelProvider: "openai", createdAt, updatedAt: createdAt,
    recencyAt: null, status: {type: "idle"}, path: null, cwd: "/workspace",
    cliVersion: "test", source: "appServer", canAcceptDirectInput: null,
    threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns,
  };
}
