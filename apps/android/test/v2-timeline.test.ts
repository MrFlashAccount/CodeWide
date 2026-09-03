import type { V2Item, V2TurnView } from "@codewide/sync-client/v2";
import { describe, expect, it } from "vitest";

import {
  activityDisplayModel,
  timelineTurnsDisplayModel,
} from "../src/v2/features/conversation/timelineDisplayModel";
import { unsupportedItemRecoveryPrompt } from "../src/v2/features/conversation/unsupportedItemRecovery";
import { legendInitialPositionProps } from "../src/v2/presentation/conversation/timelineInitialPosition";
import { turnsAfter } from "../src/v2/presentation/conversation/timelineViewport";
import type { TimelineDisplayTurn } from "../src/v2/presentation/conversation/timelineTypes";

describe("V2 timeline projection", () => {
  it("builds a recovery draft from only the sanitized unsupported payload", () => {
    expect(unsupportedItemRecoveryPrompt("futureItem", '{"detail":"unknown"}')).toContain(
      'Source kind: "futureItem"\nThe payload below was bounded and sanitized by Companion',
    );
    expect(unsupportedItemRecoveryPrompt("futureItem", '{"detail":"unknown"}')).toContain(
      '```json\n{"detail":"unknown"}\n```',
    );
  });

  it("keeps authoritative pre-turn items outside collapsed response activity", () => {
    const [display] = timelineTurnsDisplayModel([
      turn({
        items: [
          userMessage("user", "Question"),
          {
            command: "prepare",
            cwd: "/workspace",
            exitCode: null,
            id: "prepare",
            kind: "command",
            outputPreview: "ready",
            status: "completed",
          },
          { id: "answer-a", kind: "assistantText", text: "Part one" },
          { id: "answer-b", kind: "assistantText", text: "Part two" },
          {
            appContext: null,
            error: null,
            id: "tool",
            kind: "tool",
            name: "Search",
            pluginId: null,
            readOnlyHint: null,
            status: "running",
            success: null,
            summary: "Looking",
          },
        ],
        lifecycle: [
          {
            item: {
              command: "prepare",
              cwd: "/workspace",
              exitCode: null,
              id: "prepare",
              kind: "command",
              outputPreview: "ready",
              status: "completed",
            },
            phase: "completed",
            preTurn: true,
          },
        ],
        state: "running",
      }),
    ]);

    expect(display?.lifecycle.map(({ id }) => id)).toEqual(["prepare"]);
    expect(display?.activities.map(({ id }) => id)).toEqual(["tool"]);
    expect(display?.activityCount).toBe(1);
    expect(display?.assistantItemId).toBe("answer-b");
    expect(display?.assistantText).toEqual(["Part one", "Part two"]);
    expect(display?.responseRows.map((row) => row.id)).toEqual(["answer-a", "answer-b", "tool"]);
  });

  it("preserves authoritative interleaving of assistant text and activity", () => {
    const [display] = timelineTurnsDisplayModel([
      turn({
        items: [
          userMessage("user", "Question"),
          { id: "commentary", kind: "assistantText", text: "Checking now" },
          {
            command: "inspect",
            cwd: "/workspace",
            exitCode: 0,
            id: "command",
            kind: "command",
            outputPreview: "done",
            status: "completed",
          },
          { id: "final", kind: "assistantText", text: "Finished" },
        ],
        lifecycle: [],
        state: "completed",
      }),
    ]);

    expect(display?.responseRows.map((row) => [row.kind, row.id])).toEqual([
      ["assistant", "commentary"],
      ["activity", "command"],
      ["assistant", "final"],
    ]);
  });

  it("preserves ordered user input blocks and resolves their authoritative attachments", () => {
    const [display] = timelineTurnsDisplayModel(
      [
        turn({
          items: [
            {
              clientId: "client-message",
              content: [
                {
                  kind: "text",
                  text: "Question",
                  textElements: [{ byteRange: { end: 8, start: 0 }, placeholder: "question" }],
                },
                { detail: "original", kind: "image", url: "/workspace/image.png" },
                { kind: "localAudio", path: "/workspace/audio.wav" },
                { kind: "skill", name: "review", path: "/skills/review/SKILL.md" },
                { kind: "mention", name: "notes.md", path: "/workspace/notes.md" },
              ],
              id: "user",
              kind: "userMessage",
            },
          ],
          lifecycle: [],
          state: "completed",
        }),
      ],
      [
        {
          downloadUrl: "/v2/files/preview?path=%2Fworkspace%2Fimage.png",
          id: "image-attachment",
          mediaType: "image/png",
          name: "image.png",
          sizeBytes: "10",
        },
        {
          downloadUrl: "/v2/files/preview?path=%2Fworkspace%2Faudio.wav",
          id: "audio-attachment",
          mediaType: "audio/wav",
          name: "audio.wav",
          sizeBytes: "20",
        },
        {
          downloadUrl: "/v2/files/preview?path=%2Fworkspace%2Fnotes.md",
          id: "notes-attachment",
          mediaType: "text/markdown",
          name: "notes.md",
          sizeBytes: "30",
        },
      ],
    );

    expect(display?.userInput.map((block) => block.kind)).toEqual([
      "text",
      "image",
      "localAudio",
      "skill",
      "mention",
    ]);
    expect(display?.userInput[0]).toMatchObject({
      textElements: [{ byteRange: { end: 8, start: 0 }, placeholder: "question" }],
    });
    expect(display?.userInput[1]).toMatchObject({
      attachment: { id: "image-attachment" },
      reference: "/workspace/image.png",
    });
    expect(display?.userInput[2]).toMatchObject({ attachment: { id: "audio-attachment" } });
    expect(display?.userInput[4]).toMatchObject({ attachment: { id: "notes-attachment" } });
    expect(display?.userText).toEqual(["Question"]);
  });

  it("preserves agent memory citations and authenticated historical image sources", () => {
    const [display] = timelineTurnsDisplayModel([
      turn({
        items: [
          {
            id: "answer",
            kind: "assistantText",
            memoryCitation: {
              entries: [{ lineEnd: 12, lineStart: 10, note: "Reconnect rule", path: "MEMORY.md" }],
              threadIds: ["source-thread"],
            },
            text: "Answer",
          },
          {
            id: "viewed",
            kind: "imageView",
            path: "/tmp/viewed.png",
            sourceUrl: "/v2/files/preview?path=%2Ftmp%2Fviewed%2Epng",
          },
          {
            id: "generated",
            kind: "imageGeneration",
            prompt: "A diagram",
            result: "https://example.test/transient.png",
            savedPath: "/tmp/generated.png",
            sourceUrl: "/v2/files/preview?path=%2Ftmp%2Fgenerated%2Epng",
            status: "completed",
          },
        ],
        lifecycle: [],
        state: "completed",
      }),
    ]);

    expect(display?.responseRows[0]).toStrictEqual({
      id: "answer",
      kind: "assistant",
      memoryCitation: {
        entries: [{ lineEnd: 12, lineStart: 10, note: "Reconnect rule", path: "MEMORY.md" }],
        threadIds: ["source-thread"],
      },
      text: "Answer",
    });
    expect(display?.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "imageView",
          sourceUrl: "/v2/files/preview?path=%2Ftmp%2Fviewed%2Epng",
        }),
        expect.objectContaining({
          kind: "imageGeneration",
          savedPath: "/tmp/generated.png",
          sourceUrl: "/v2/files/preview?path=%2Ftmp%2Fgenerated%2Epng",
        }),
      ]),
    );
  });

  it("maps protocol activity into explicit running, completed, and failed states", () => {
    expect(
      activityDisplayModel({
        appContext: null,
        error: null,
        id: "running",
        kind: "tool",
        name: "Search",
        pluginId: null,
        readOnlyHint: null,
        status: "running",
        success: null,
        summary: "Looking",
      })[0]?.state,
    ).toBe("running");
    expect(
      activityDisplayModel({
        command: "test",
        cwd: "/workspace",
        exitCode: 0,
        id: "completed",
        kind: "command",
        outputPreview: "ok",
        status: "completed",
      })[0]?.state,
    ).toBe("completed");
    expect(
      activityDisplayModel({
        command: "test",
        cwd: "/workspace",
        exitCode: 1,
        id: "failed",
        kind: "command",
        outputPreview: "no",
        status: "failed",
      })[0]?.state,
    ).toBe("failed");
  });

  it("keeps absent optional tool metadata absent in the presentation model", () => {
    expect(
      activityDisplayModel({
        id: "tool-without-metadata",
        kind: "tool",
        name: "search",
        status: "completed",
        summary: "Searched",
      }),
    ).toEqual([
      expect.objectContaining({
        appContext: null,
        error: null,
        pluginId: null,
        readOnlyHint: null,
        success: null,
      }),
    ]);
  });

  it("preserves complete typed activity payloads for the rich presentation layer", () => {
    expect(
      activityDisplayModel({
        appContext: {
          actionName: "Read",
          appName: "Workspace",
          connectorId: "workspace-connector",
          linkId: "readme-link",
          resourceUri: "file://README.md",
        },
        argumentsJson: '{"path":"README.md"}',
        durationMs: 42,
        error: { message: "authoritative source warning" },
        id: "tool",
        kind: "tool",
        name: "read_file",
        pluginId: "plugin.workspace",
        readOnlyHint: true,
        resultJson: '{"type":"resource_link","uri":"https://example.test/result"}',
        server: "workspace",
        status: "completed",
        success: false,
        summary: "Read the file",
      }),
    ).toEqual([
      {
        appContext: {
          actionName: "Read",
          appName: "Workspace",
          connectorId: "workspace-connector",
          linkId: "readme-link",
          resourceUri: "file://README.md",
        },
        argumentsJson: '{"path":"README.md"}',
        durationMs: 42,
        error: "authoritative source warning",
        id: "tool",
        kind: "tool",
        label: "read_file",
        name: "read_file",
        pluginId: "plugin.workspace",
        readOnlyHint: true,
        resultJson: '{"type":"resource_link","uri":"https://example.test/result"}',
        server: "workspace",
        state: "completed",
        success: false,
        summary: "Read the file",
      },
    ]);
    expect(
      activityDisplayModel({
        changes: [{ change: "update", diff: "-old\n+new", path: "README.md" }],
        change: "update",
        id: "change",
        kind: "fileChange",
        path: "README.md",
        status: "applied",
      })[0],
    ).toMatchObject({ changes: [{ diff: "-old\n+new" }], kind: "fileChange" });
  });

  it("uses the latest authoritative lifecycle phase for activity state", () => {
    const preflight: Extract<V2Item, { kind: "reasoning" }> = {
      id: "preflight",
      kind: "reasoning",
      summary: "Preparing",
    };
    const [started] = timelineTurnsDisplayModel([
      turn({
        items: [userMessage("user", "Question"), preflight],
        lifecycle: [{ item: preflight, phase: "started", preTurn: true }],
        state: "running",
      }),
    ]);
    const [completed] = timelineTurnsDisplayModel([
      turn({
        items: [userMessage("user", "Question"), preflight],
        lifecycle: [
          { item: preflight, phase: "started", preTurn: true },
          { item: preflight, phase: "completed", preTurn: true },
        ],
        state: "running",
      }),
    ]);

    expect(started?.lifecycle[0]?.state).toBe("running");
    expect(completed?.lifecycle[0]?.state).toBe("completed");
  });

  it("counts only turns arriving beyond the last visible tail", () => {
    const turns = [displayTurn("one"), displayTurn("two"), displayTurn("three")];
    expect(turnsAfter(turns, "one")).toBe(2);
    expect(turnsAfter(turns, "three")).toBe(0);
    expect(turnsAfter(turns, "missing")).toBe(0);
  });

  it("keeps tail and restored-item initial positions mutually exclusive", () => {
    expect(legendInitialPositionProps({ kind: "tail" })).toEqual({ initialScrollAtEnd: true });
    expect(
      legendInitialPositionProps({ kind: "item", index: 7, viewOffset: 12, viewPosition: 0 }),
    ).toEqual({ initialScrollIndex: { index: 7, viewOffset: 12, viewPosition: 0 } });
  });
});

function turn(input: Pick<V2TurnView, "items" | "lifecycle" | "state">): V2TurnView {
  return {
    activity: { count: 2, kinds: ["command", "tool"] },
    completedAt: null,
    createdAt: "2026-09-03T00:00:00Z",
    durationMs: null,
    id: "turn",
    items: input.items,
    lifecycle: input.lifecycle,
    state: input.state,
    threadId: "thread",
    usage: null,
  };
}

function displayTurn(id: string): TimelineDisplayTurn {
  return {
    activityCount: 0,
    activities: [],
    assistantText: [id],
    completedAt: "2026-09-03T00:00:01Z",
    createdAt: "2026-09-03T00:00:00Z",
    durationMs: 1000,
    id,
    lifecycle: [],
    responseRows: [{ id: `${id}-assistant`, kind: "assistant", memoryCitation: null, text: id }],
    state: "completed",
    usage: null,
    userInput: [],
    userText: [],
  };
}

function userMessage(id: string, text: string): V2Item {
  return {
    clientId: null,
    content: [{ kind: "text", text, textElements: [] }],
    id,
    kind: "userMessage",
  };
}
