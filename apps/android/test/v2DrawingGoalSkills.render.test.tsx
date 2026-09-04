import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import type { V2ThreadGoal } from "@codewide/sync-client/v2";

import {
  commitDrawingAttachment,
  quickdrawAttachmentName,
  quickdrawPngBytes,
} from "../src/v2/application/drawing/drawingAttachment";
import {
  createQuickdrawImageSnapshot,
  parseQuickdrawImageSnapshot,
} from "../src/v2/application/drawing/quickdrawImage";
import { updateThreadGoal, validateThreadGoal } from "../src/v2/application/goal/threadGoal";
import {
  insertSkillInvocation,
  skillInputBlock,
  type SkillCatalogEntry,
} from "../src/v2/application/skills/skillSelection";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { createAttachmentAnnotationCapability } from "../src/v2/features/drawing/attachmentAnnotation";
import { drawingWorkspaceRequest } from "../src/v2/features/drawing/drawingDraft";
import { ThreadGoalSheetView } from "../src/v2/presentation/goal/ThreadGoalSheetView";
import { SkillsSheetView } from "../src/v2/presentation/skills/SkillsSheetView";

const serverId = savedServerId("saved-server-a");
const conversationThreadId = threadId("thread-a");

describe("V2 Drawing, Goal, and Skills", () => {
  it("commits a validated QuickDraw PNG through the injected attachment boundary", async () => {
    const attachBytes = jest.fn(async () => "draft-a");
    const replaceBytes = jest.fn(async () => undefined);
    const draftItemId = await commitDrawingAttachment(
      { attachBytes, replaceBytes },
      {
        draftItemId: null,
        mode: "drawing",
        name: "drawing.png",
        pngDataUrl: "data:image/png;base64,AQID",
        revision: 1,
        snapshot: { elements: [] },
      },
    );

    expect(Array.from(quickdrawPngBytes("data:image/png;base64,AQID"))).toEqual([1, 2, 3]);
    expect(quickdrawAttachmentName(new Date("2026-09-03T10:11:12.345Z"))).toBe(
      "drawing-2026-09-03T10-11-12-345Z.png",
    );
    expect(attachBytes).toHaveBeenCalledWith(
      "drawing.png",
      "image/png",
      new Uint8Array([1, 2, 3]),
      {
        kind: "quickdraw",
        mode: "drawing",
        revision: 1,
        snapshot: '{"elements":[]}',
      },
    );
    expect(replaceBytes).not.toHaveBeenCalled();
    expect(draftItemId).toBe("draft-a");
  });

  it("rejects malformed QuickDraw exports before calling upload", async () => {
    const attachBytes = jest.fn(async () => "draft-a");
    const replaceBytes = jest.fn(async () => undefined);

    await expect(
      commitDrawingAttachment(
        { attachBytes, replaceBytes },
        {
          draftItemId: null,
          mode: "drawing",
          name: "drawing.png",
          pngDataUrl: "data:text/plain;base64,AQID",
          revision: 1,
          snapshot: {},
        },
      ),
    ).rejects.toThrow("QuickDraw did not return a PNG image");
    expect(attachBytes).not.toHaveBeenCalled();
    expect(replaceBytes).not.toHaveBeenCalled();
  });

  it("preserves the local draft identity when editing a drawing", async () => {
    const attachBytes = jest.fn(async () => "unexpected-draft");
    const replaceBytes = jest.fn(async () => undefined);
    const snapshot = createQuickdrawImageSnapshot("data:image/png;base64,AQID", 320, 180);
    const draftItemId = await commitDrawingAttachment(
      { attachBytes, replaceBytes },
      {
        draftItemId: "draft-a",
        mode: "image-annotation",
        name: "annotated.png",
        pngDataUrl: "data:image/png;base64,AQID",
        revision: 7,
        snapshot,
      },
    );

    expect(attachBytes).not.toHaveBeenCalled();
    expect(replaceBytes).toHaveBeenCalledWith(
      "draft-a",
      "annotated.png",
      "image/png",
      new Uint8Array([1, 2, 3]),
      {
        kind: "quickdraw",
        mode: "imageAnnotation",
        revision: 7,
        snapshot: JSON.stringify(snapshot),
      },
    );
    expect(draftItemId).toBe("draft-a");
  });

  it("restores editable QuickDraw state only for QuickDraw draft attachments", () => {
    const snapshot = {
      ...createQuickdrawImageSnapshot("data:image/png;base64,AQID", 320, 180),
      session: { camera: { x: 1, y: 2 } },
    };
    expect(
      drawingWorkspaceRequest({
        editor: {
          kind: "quickdraw",
          mode: "imageAnnotation",
          revision: 7,
          snapshot: JSON.stringify(snapshot),
        },
        error: null,
        id: "draft-a",
        mediaType: "image/png",
        name: "annotated.png",
        progress: null,
        sizeBytes: 3,
        state: "selected",
      }),
    ).toEqual({
      draftItemId: "draft-a",
      initialSnapshot: snapshot,
      mode: "image-annotation",
      name: "annotated.png",
    });
    expect(parseQuickdrawImageSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("opens a materialized image as a new annotation drawing", async () => {
    const snapshot = createQuickdrawImageSnapshot("data:image/png;base64,AQID", 320, 180);
    const source = { contentType: "image/png", name: "screen.png", uri: "file:///screen.png" };
    const load = jest.fn(async () => snapshot);
    const present = jest.fn();
    const annotate = createAttachmentAnnotationCapability({
      imageSource: { load },
      now: () => new Date("2026-09-03T10:11:12.345Z"),
      present,
    });

    await annotate({ attachmentId: "attachment-a", name: "screen.png", source });

    expect(load).toHaveBeenCalledWith(source);
    expect(present).toHaveBeenCalledWith({
      draftItemId: null,
      initialSnapshot: snapshot,
      mode: "image-annotation",
      name: "annotated-screen-2026-09-03T10-11-12-345Z.png",
    });
  });

  it("sends typed set and clear goal mutations and accepts only matching results", async () => {
    const execute = jest.fn(async () => ({
      operationId: "operation-a",
      result: {
        kind: "thread.update" as const,
        thread: threadSummary(),
      },
      type: "commandCompleted" as const,
    }));

    await updateThreadGoal({
      commands: { execute },
      goal: validateThreadGoal("  Ship V2  ", "12000", "paused"),
      savedServerId: serverId,
      threadId: conversationThreadId,
    });
    await updateThreadGoal({
      commands: { execute },
      goal: null,
      savedServerId: serverId,
      threadId: conversationThreadId,
    });

    expect(execute).toHaveBeenNthCalledWith(1, serverId, {
      change: {
        goal: { objective: "Ship V2", status: "paused", tokenBudget: 12000 },
        kind: "goal",
      },
      kind: "thread.update",
      threadId: conversationThreadId,
    });
    expect(execute).toHaveBeenNthCalledWith(2, serverId, {
      change: { goal: null, kind: "goal" },
      kind: "thread.update",
      threadId: conversationThreadId,
    });
    expect(() => validateThreadGoal("Ship V2", "0")).toThrow(
      "Token budget must be a positive integer",
    );
  });

  it("keeps goal draft local and closes only after authoritative save", async () => {
    const save = deferred<void>();
    const onClose = jest.fn();
    render(
      <ControlledGoalView
        error={null}
        goal={null}
        loading={false}
        onClear={async () => undefined}
        onClose={onClose}
        onSave={() => save.promise}
      />,
    );

    fireEvent.changeText(screen.getByLabelText("Goal objective"), "Ship V2");
    fireEvent.press(screen.getByLabelText("Create goal"));

    expect(screen.getByLabelText("Create goal").props.accessibilityState.busy).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      save.resolve();
      await save.promise;
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("requires confirmation before clearing an existing goal", async () => {
    const onClear = jest.fn(async () => undefined);
    const onClose = jest.fn();
    render(
      <ControlledGoalView
        error={null}
        goal={goalFixture()}
        loading={false}
        onClear={onClear}
        onClose={onClose}
        onSave={async () => undefined}
      />,
    );

    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("1m 30s")).toBeTruthy();
    expect(screen.getByText(/5,000 · 25% of budget/u)).toBeTruthy();
    expect(screen.getByText("Not reported")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Clear goal"));
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByText("Remove this goal from the thread?")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Confirm clear goal"));
    });
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("inserts a selected skill at the current selection and produces its V2 payload block", () => {
    const skill = skillFixture();
    const result = insertSkillInvocation("Ask now", { end: 3, start: 0 }, skill);

    expect(result).toEqual({
      block: { kind: "skill", name: "research", path: "/skills/research/SKILL.md" },
      selection: { end: 10, start: 10 },
      text: "$research now",
    });
    expect(skillInputBlock(skill)).toEqual({
      kind: "skill",
      name: "research",
      path: "/skills/research/SKILL.md",
    });
  });

  it("renders authoritative skills and invokes only enabled entries", () => {
    const onSelect = jest.fn();
    render(
      <SkillsSheetView
        actionable
        error={null}
        loading={false}
        onClose={() => undefined}
        onSelect={onSelect}
        skills={[
          skillFixture(),
          {
            ...skillFixture(),
            enabled: false,
            name: "disabled",
            path: "/skills/disabled/SKILL.md",
          },
        ]}
        workspaceLabel="/workspace"
      />,
    );

    fireEvent.press(screen.getByLabelText("research"));
    fireEvent.press(screen.getByLabelText("disabled"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(skillFixture());
  });
});

interface ControlledGoalViewProps {
  error: string | null;
  goal: V2ThreadGoal | null;
  loading: boolean;
  onClear(): Promise<void>;
  onClose(): void;
  onSave(): Promise<void>;
}

function ControlledGoalView(props: ControlledGoalViewProps): React.JSX.Element {
  const [objective, setObjective] = useState(props.goal?.objective ?? "");
  const [tokenBudget, setTokenBudget] = useState(
    props.goal?.tokenBudget === null || props.goal?.tokenBudget === undefined
      ? ""
      : String(props.goal.tokenBudget),
  );
  return (
    <ThreadGoalSheetView
      {...props}
      objective={objective}
      onObjectiveChange={setObjective}
      onTokenBudgetChange={setTokenBudget}
      tokenBudget={tokenBudget}
    />
  );
}

function goalFixture(): V2ThreadGoal {
  return {
    createdAtMs: 1,
    objective: "Ship V2",
    status: "active",
    threadId: conversationThreadId,
    timeUsedSeconds: 90,
    tokenBudget: 20_000,
    tokensUsed: 5_000,
    updatedAtMs: 2,
  };
}

function skillFixture(): SkillCatalogEntry {
  return {
    description: "Research an unfamiliar topic",
    enabled: true,
    name: "research",
    path: "/skills/research/SKILL.md",
  };
}

function threadSummary() {
  return {
    archived: false,
    createdAt: "2026-09-03T00:00:00Z",
    headTurnId: null,
    id: conversationThreadId,
    lastActivityAt: null,
    parentId: null,
    preview: "",
    settings: null,
    state: "idle" as const,
    title: "Thread",
    updatedAt: "2026-09-03T00:00:00Z",
    workspace: "/workspace",
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
