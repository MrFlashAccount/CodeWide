import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { TimelineActivityView } from "../src/v2/presentation/conversation/timelineActivityView";
import type {
  TimelineDisplayActivity,
  TimelineDisplayResponseRow,
} from "../src/v2/presentation/conversation/timelineTypes";

describe("V2 rich timeline activity", () => {
  it("renders tool metadata, arguments, result resources, and the complete raw result", () => {
    renderActivity(
      <TimelineActivityView
        activityCount={1}
        rows={[activityRow(toolActivity())]}
        turnId="turn-a"
        turnState="completed"
      />,
    );

    fireEvent.press(screen.getByLabelText("Expand activity Activity"));

    expect(
      screen.getByText(
        "workspace · plugin plugin.workspace · read-only hint: true · success: true · 42 ms",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Read the file")).toBeTruthy();
    expect(
      screen.getByText(
        '{\n  "actionName": "Read",\n  "appName": "Workspace",\n  "connectorId": "workspace-connector",\n  "linkId": "readme-link",\n  "resourceUri": "file://README.md"\n}',
      ),
    ).toBeTruthy();
    expect(screen.getByText('{\n  "path": "README.md"\n}')).toBeTruthy();
    expect(screen.getByText("[Result](https://example.test/result)")).toBeTruthy();
    expect(
      screen.getByText(
        '{\n  "type": "resource_link",\n  "title": "Result",\n  "uri": "https://example.test/result"\n}',
      ),
    ).toBeTruthy();
    expect(screen.getByText("authoritative source warning")).toBeTruthy();
  });

  it("retries a failed lazy activity load with one tap without collapsing", async () => {
    const load = jest
      .fn<() => Promise<TimelineDisplayResponseRow[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([activityRow(toolActivity())]);
    renderActivity(
      <TimelineActivityView
        activityCount={1}
        rows={[]}
        onLoadActivity={load}
        turnId="turn-a"
        turnState="completed"
      />,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Expand activity Activity")));
    expect(
      await screen.findByText(
        "Could not load complete activity. Tap the activity header to retry.",
      ),
    ).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByLabelText("Collapse activity Activity")));

    expect(load).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Read the file")).toBeTruthy();
  });

  it("opens attachment and subagent activities through qualified feature actions", async () => {
    const openAttachment = jest.fn(async () => undefined);
    const openSubagent = jest.fn(async () => undefined);
    renderActivity(
      <TimelineActivityView
        actions={{ onOpenAttachment: openAttachment, onOpenSubagent: openSubagent }}
        activityCount={2}
        rows={[activityRow(attachmentActivity()), activityRow(subagentActivity())]}
        turnId="turn-a"
        turnState="completed"
      />,
    );

    fireEvent.press(screen.getByLabelText("Expand activity 2 activities · 2"));
    await act(async () => fireEvent.press(screen.getByLabelText("Open attachment report.md")));
    await act(async () => fireEvent.press(screen.getByLabelText("Open subagent conversation")));

    expect(openAttachment).toHaveBeenCalledWith({
      downloadUrl: "/v2/files/preview?path=report.md",
      id: "attachment-a",
      mediaType: "text/markdown",
      name: "report.md",
      sizeBytes: "1024",
    });
    expect(openSubagent).toHaveBeenCalledWith("thread-child");
  });

  it("opens authoritative command output with the owning turn and item", async () => {
    const openItemOutput = jest.fn(async () => undefined);
    renderActivity(
      <TimelineActivityView
        actions={{ onOpenItemOutput: openItemOutput }}
        activityCount={1}
        rows={[activityRow(commandActivity())]}
        turnId="turn-a"
        turnState="completed"
      />,
    );

    fireEvent.press(screen.getByLabelText("Expand activity Activity"));
    await act(async () => fireEvent.press(screen.getByLabelText("Open full output for Command")));

    expect(openItemOutput).toHaveBeenCalledWith("turn-a", "command-a");
    expect(screen.queryByLabelText("Open full text output")).toBeNull();
  });
});

function renderActivity(element: ReactElement): ReturnType<typeof render> {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      {element}
    </SafeAreaProvider>,
  );
}

function activityRow(activity: TimelineDisplayActivity): TimelineDisplayResponseRow {
  return { activity, id: activity.id, kind: "activity" };
}

function toolActivity(): TimelineDisplayActivity {
  return {
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
    resultJson: '{"type":"resource_link","title":"Result","uri":"https://example.test/result"}',
    server: "workspace",
    state: "completed",
    success: true,
    summary: "Read the file",
  };
}

function commandActivity(): TimelineDisplayActivity {
  return {
    command: "pnpm test",
    cwd: "/workspace",
    durationMs: 42,
    exitCode: 0,
    id: "command-a",
    kind: "command",
    label: "Command",
    output: "x".repeat(16_384),
    state: "completed",
  };
}

function attachmentActivity(): TimelineDisplayActivity {
  return {
    attachment: {
      downloadUrl: "/v2/files/preview?path=report.md",
      id: "attachment-a",
      mediaType: "text/markdown",
      name: "report.md",
      sizeBytes: "1024",
    },
    id: "attachment-item",
    kind: "attachment",
    label: "Attachment",
    state: "completed",
  };
}

function subagentActivity(): TimelineDisplayActivity {
  return {
    activityKind: "spawn",
    agentPath: ["reviewer"],
    agentThreadId: "thread-child",
    id: "subagent",
    kind: "subagentActivity",
    label: "Subagent",
    state: "completed",
  };
}
