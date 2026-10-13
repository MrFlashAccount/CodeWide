import { expect, it } from "vitest";

import { MAX_TURN_ATTACHMENTS, MAX_TURN_SKILLS, MAX_TURN_TEXT_CHARS } from "../src/index.js";
import { createTextOutboxCommand } from "../src/outbox.js";

it("sends the selected Fast tier on a new turn without changing a steer command", () => {
  const options = { model: "gpt-6-sol", effort: "ultra", serviceTier: "priority" };
  const start = createTextOutboxCommand("server", "thread", "hello", { type: "start" }, options);
  const steer = createTextOutboxCommand("server", "thread", "hello", { type: "steer", expectedTurnId: "turn" }, options);
  expect(start.params).toMatchObject({ model: "gpt-6-sol", effort: "ultra", serviceTier: "priority" });
  expect(steer.params).not.toHaveProperty("serviceTier");
});

it("does not send turn/start-only overrides in a steer request", () => {
  const command = createTextOutboxCommand(
    "server",
    "thread",
    "change direction",
    { type: "steer", expectedTurnId: "active-turn" },
    {
      model: "gpt-5.6",
      effort: "high",
      personality: "pragmatic",
      permissions: ":workspace",
      skills: [{ name: "openai-docs", path: "/skills/openai-docs" }],
    },
    "steer-1",
  );
  expect(command.method).toBe("turn/steer");
  expect(command.params).toEqual({
    threadId: "thread",
    clientUserMessageId: "steer-1",
    expectedTurnId: "active-turn",
    input: [
      { type: "text", text: "change direction", text_elements: [] },
      { type: "skill", name: "openai-docs", path: "/skills/openai-docs" },
    ],
  });
});

it("persists root-scoped file inputs for companion-side resolution", () => {
  const command = createTextOutboxCommand("server", "thread", "inspect this", { type: "start" }, {
    attachments: [{ id: "a1", rootId: "workspace", path: "uploads/screenshot.png", name: "screenshot.png", kind: "image" }],
  });
  expect(command.params.input).toEqual([
    { type: "text", text: "inspect this", text_elements: [] },
    { type: "remoteFile", rootId: "workspace", path: "uploads/screenshot.png", name: "screenshot.png", kind: "image" },
  ]);
});

it("queues a queue command and starts a start command", () => {
  expect(createTextOutboxCommand("server", "thread", "later", { type: "queue" }).state).toBe("queued");
  expect(createTextOutboxCommand("server", "thread", "now").state).toBe("pending");
});

it("rejects empty or unbounded commands", () => {
  expect(() => createTextOutboxCommand("server", "thread", "")).toThrow("empty");
  expect(() => createTextOutboxCommand("server", "thread", "x".repeat(MAX_TURN_TEXT_CHARS + 1))).toThrow("exceeds");
  expect(() =>
    createTextOutboxCommand("server", "thread", "x", { type: "start" }, {
      attachments: Array.from({ length: MAX_TURN_ATTACHMENTS + 1 }, (_, index) => ({
        id: `a-${index}`, rootId: "workspace", path: `uploads/${index}`, name: String(index), kind: "file" as const,
      })),
    }),
  ).toThrow("attachments");
  expect(() =>
    createTextOutboxCommand("server", "thread", "x", { type: "start" }, {
      skills: Array.from({ length: MAX_TURN_SKILLS + 1 }, (_, index) => ({ name: `skill-${index}`, path: `/skills/${index}` })),
    }),
  ).toThrow("skills");
});
