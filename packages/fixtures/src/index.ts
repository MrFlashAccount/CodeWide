import type { Thread, ThreadItem, Turn } from "@codewide/codex-protocol/v0.147.0/v2";

export function fixtureUserMessage(id: string, text: string): ThreadItem {
  return {
    type: "userMessage",
    id,
    clientId: `client-${id}`,
    content: [{ type: "text", text, text_elements: [] }],
  };
}

export function fixtureAgentMessage(id: string, text: string): ThreadItem {
  return {
    type: "agentMessage",
    id,
    text,
    phase: "final_answer",
    memoryCitation: null,
  };
}

export function fixtureTurn(id: string, userText: string, agentText: string): Turn {
  return {
    id,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 1_787_000_000,
    completedAt: 1_787_000_001,
    durationMs: 1_000,
    items: [
      fixtureUserMessage(`${id}-user`, userText),
      fixtureAgentMessage(`${id}-agent`, agentText),
    ],
  };
}

export function createFixtureThread(turns: Turn[] = [
  fixtureTurn(
    "fixture-turn",
    "Render the deterministic fixture.",
    "## Fixture response\n\n- [x] Markdown\n- [x] Stable protocol data\n\n| Surface | State |\n| --- | --- |\n| Renderer | Ready |",
  ),
]): Thread {
  return {
    id: "fixture-thread",
    extra: null,
    sessionId: "fixture-session",
    forkedFromId: null,
    parentThreadId: null,
    preview: "Deterministic protocol fixture",
    ephemeral: true,
    section: null,
    sectionEnteredAt: null,
    historyMode: "paginated",
    modelProvider: "openai",
    createdAt: 1_787_000_000,
    updatedAt: 1_787_000_001,
    recencyAt: 1_787_000_001,
    status: { type: "idle" },
    path: null,
    cwd: "/workspace/project",
    cliVersion: "0.147.0",
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: "fixture",
    agentNickname: null,
    agentRole: null,
    gitInfo: {
      sha: "0123456789abcdef",
      branch: "test/fixture",
      originUrl: "https://example.test/codewide.git",
    },
    name: "Deterministic fixture",
    turns,
  };
}

export function createLargeFixtureThread(turnCount = 320): Thread {
  return createFixtureThread(Array.from({ length: turnCount }, (_, index) => fixtureTurn(
    `fixture-turn-${index}`,
    `Fixture request ${index}`,
    `## Result ${index}\n\nDeterministic response ${index}.\n\n- item one\n- item two\n\n\`inline-${index}\``,
  )));
}
