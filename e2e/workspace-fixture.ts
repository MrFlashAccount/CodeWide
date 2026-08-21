import type { Page } from "@playwright/test";
import type { Thread, ThreadItem } from "@codewide/codex-protocol/v0.147.0/v2";
import { createFixtureThread, fixtureAgentMessage, fixtureUserMessage } from "../packages/fixtures/src/index.js";

const activeItems: ThreadItem[] = [
  fixtureUserMessage("release-user", "Update the changelog for v1.4 with the latest commits, bump the version to 1.4.0, and open a PR."),
  { type: "plan", id: "release-plan", text: "Update release metadata and verify the build." },
  { type: "reasoning", id: "release-reasoning", summary: ["Compared the release branch with v1.3.0."], content: [] },
  {
    type: "commandExecution", id: "release-command-1", pluginId: null, scriptPath: null,
    command: "git log v1.3.0..HEAD --oneline", cwd: "/workspace/project", processId: null,
    source: "agent", status: "completed", commandActions: [], aggregatedOutput: "a1b2c3d feat: release fixture", exitCode: 0, durationMs: 50,
  },
  { type: "fileChange", id: "release-files", changes: [{ path: "/workspace/project/CHANGELOG.md", kind: { type: "update", move_path: null }, diff: "- 1.3.0\n+ 1.4.0\n" }], status: "completed" },
  {
    type: "commandExecution", id: "release-command-2", pluginId: null, scriptPath: null,
    command: "pnpm test", cwd: "/workspace/project", processId: null,
    source: "agent", status: "completed", commandActions: [], aggregatedOutput: "tests passed", exitCode: 0, durationMs: 80,
  },
  { type: "webSearch", id: "release-search", query: "semantic version changelog conventions", action: null, results: [] },
  { type: "contextCompaction", id: "release-compaction" },
  fixtureAgentMessage("release-agent", "I updated the changelog, bumped the version to 1.4.0, and opened a pull request."),
];

const activeThread: Thread = {
  ...createFixtureThread(),
  id: "release",
  name: "🚀 Release v1.4",
  preview: "Update changelog, bump version, and open PR.",
  turns: [{
    ...createFixtureThread().turns[0]!,
    id: "release-turn",
    durationMs: 88_000,
    items: activeItems,
  }],
};

const workspace = {
  servers: [
    { id: "orbit", name: "Orbit", emoji: "🚀", status: "live" },
    { id: "lab", name: "Lab", emoji: "🧪", status: "live" },
    { id: "home", name: "Home", emoji: "🏠", status: "syncing" },
    { id: "agents", name: "Agents", emoji: "🤖", status: "offline" },
  ],
  threads: [
    { id: "release", serverId: "orbit", title: "🚀 Release v1.4", preview: "Update changelog, bump version, and open PR.", time: "10:42", pinned: true, unread: 2 },
    { id: "rag", serverId: "orbit", title: "🧪 Experiment: RAG eval", preview: "Results for search quality tuning.", time: "09:18", pinned: true, unread: 1 },
    { id: "chores", serverId: "orbit", title: "🏠 Weekly chores bot", preview: "Add recurring cleanup and report summary.", time: "Wed", pinned: true, unread: 0 },
    { id: "metrics", serverId: "orbit", title: "Add metrics endpoint", preview: "Expose /v1/metrics and tests.", time: "Mon", pinned: false, unread: 0 },
    { id: "backfill", serverId: "orbit", title: "Data pipeline backfill", preview: "Backfill missing events for April.", time: "Mon", pinned: false, unread: 0, state: "approval" },
    { id: "backup", serverId: "orbit", title: "Home NAS backup", preview: "Verify incremental backup job.", time: "Sun", pinned: false, archived: true, unread: 0 },
    { id: "renderer", serverId: "lab", title: "Rich renderer benchmark", preview: "Profile a large deterministic fixture.", time: "11:04", pinned: true, unread: 4, state: "running" },
    { id: "release", serverId: "lab", title: "Duplicate ID isolation", preview: "Same remote thread id on another server.", time: "10:58", pinned: false, unread: 0 },
    { id: "recovery", serverId: "lab", title: "Sleep/wake recovery", preview: "Replay after process recreation.", time: "Yesterday", pinned: false, unread: 0 },
    { id: "network", serverId: "home", title: "Localhost tunnel", preview: "WebSocket and HMR proxy validation.", time: "Sat", pinned: true, unread: 0 },
  ],
  thread: activeThread,
  controls: {
    models: [
      { id: "gpt-5.6", label: "GPT-5.6", defaultEffort: "high", efforts: ["low", "medium", "high", "xhigh"], supportsPersonality: true },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", defaultEffort: "medium", efforts: ["low", "medium", "high"], supportsPersonality: false },
    ],
    skills: [
      { name: "fixture-skill", path: "/fixtures/SKILL.md", description: "Deterministic fixture skill", enabled: true },
    ],
    permissions: [
      { id: ":read-only", description: "Read workspace files", allowed: true },
      { id: ":workspace", description: "Read and write inside the workspace", allowed: true },
    ],
    defaults: { model: "gpt-5.6", effort: "high", permissions: ":workspace" },
  },
};

export async function installWorkspaceFixture(page: Page): Promise<void> {
  await page.addInitScript((value) => {
    (globalThis as typeof globalThis & { __CODEWIDE_TEST_WORKSPACE__?: unknown }).__CODEWIDE_TEST_WORKSPACE__ = value;
  }, workspace);
}
