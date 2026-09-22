import { DatabaseSync } from "node:sqlite";
import type { SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";

export function sqliteFixture() {
  const native = new DatabaseSync(":memory:");
  const executor = {
    async execute(sql: string, params: readonly SqliteValue[] = []) {
      const values = params.map((value) => {
        if (value === null || typeof value === "string" || typeof value === "number") return value;
        throw new Error("Unexpected SQLite parameter");
      });
      const statement = native.prepare(sql);
      return statement.columns().length > 0
        ? { rows: statement.all(...values) }
        : statement.run(...values);
    },
  };
  let tail = Promise.resolve();
  const database = {
    ...executor,
    transaction<T>(operation: (executor: SqliteExecutor) => Promise<T>): Promise<T> {
      const result = tail.then(async () => {
        native.exec("BEGIN");
        try {
          const value = await operation(executor);
          native.exec("COMMIT");
          return value;
        } catch (error) {
          native.exec("ROLLBACK");
          throw error;
        }
      });
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  return { native, database, settled: () => tail };
}

export function catalogThread(index: number): Thread {
  return {
    environments: null,
    projectId: null,
    model: null,
    reasoningEffort: null,
    originator: null,
    daybreakEnabled: null,
    id: `thread-${index}`,
    parentThreadId: null,
    name: `Chat ${index}`,
    preview: "",
    cwd: "/repo",
    updatedAt: 1000 - index,
    status: { type: "idle" },
    ephemeral: false,
    turns: [],
    extra: null,
    sessionId: `session-${index}`,
    forkedFromId: null,
    section: null,
    sectionEnteredAt: null,
    historyMode: "default",
    modelProvider: "openai",
    createdAt: 1,
    recencyAt: 1000 - index,
    path: null,
    cliVersion: "test",
    source: "cli",
    canAcceptDirectInput: null,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
  };
}
