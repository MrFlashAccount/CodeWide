import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { V2PendingRequest } from "@codewide/sync-client/v2";

import type { V2Runtime } from "../src/v2/application/v2Runtime";
import { V2RuntimeProvider } from "../src/v2/application/react/V2RuntimeContext";
import { ObservableResource } from "../src/v2/application/resources/resource";
import { VoiceInputController } from "../src/v2/application/voiceInputController";
import { savedServerId } from "../src/v2/domain/ids";
import { PendingRequestsPanel } from "../src/v2/features/requests/PendingRequestsPanel";

const serverId = savedServerId("saved-server-a");

describe("V2 pending request surfaces", () => {
  it("shows only requests owned by the active thread", () => {
    const resolve = jest.fn(async () => undefined);
    const otherThread = { ...approvalRequest("other"), threadId: "thread-b" };
    renderPanel([otherThread, approvalRequest("current")], resolve);

    expect(screen.queryByText("other")).toBeNull();
    expect(screen.getByText("current")).toBeTruthy();
  });

  it("renders the authoritative file-change approval shape without invented change rows", () => {
    const resolve = jest.fn(async () => undefined);
    const request: V2PendingRequest = {
      availableDecisions: ["accept", "decline"],
      generation: "3",
      grantRoot: "/workspace",
      id: "file-change-a",
      itemId: "item-a",
      kind: "fileChangeApproval",
      reason: null,
      threadId: "thread-a",
      turnId: "turn-a",
    };
    renderPanel([request], resolve);

    expect(screen.getByText("Review proposed file changes")).toBeTruthy();
    expect(screen.getByText("⌁ /workspace")).toBeTruthy();
    expect(screen.getByLabelText("Accept once")).toBeTruthy();
    expect(screen.getByLabelText("Decline")).toBeTruthy();
    expect(screen.queryByLabelText("For session")).toBeNull();
  });

  it("preserves an execpolicy amendment decision through the approval view", async () => {
    const resolve = jest.fn(async () => undefined);
    const decision = {
      acceptWithExecpolicyAmendment: { execpolicy_amendment: ["cargo", "test"] },
    };
    const request: V2PendingRequest = {
      ...approvalRequest("approval-with-amendment"),
      availableDecisions: [decision, "decline"],
    };
    renderPanel([request], resolve);

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Accept and remember"));
      await flushAsyncWork();
    });

    expect(resolve).toHaveBeenCalledWith(serverId, request, {
      decision,
      kind: "commandApproval",
    });
  });

  it("resolves the first approval and keeps it visible until authority closes it", async () => {
    const resolve = jest.fn(async () => undefined);
    const requests: V2PendingRequest[] = [
      approvalRequest("approval-a"),
      approvalRequest("approval-b"),
    ];
    const view = renderPanel(requests, resolve);

    expect(screen.getByText("1/2")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText("For session"));
      await flushAsyncWork();
    });

    expect(screen.getByText("approval-a")).toBeTruthy();
    expect(resolve).toHaveBeenCalledWith(serverId, requests[0], {
      decision: "acceptForSession",
      kind: "commandApproval",
    });
    expect(screen.getByText("approval-a")).toBeTruthy();

    await act(async () => {
      view.rerender(panel(requests.slice(1), resolve));
      await flushAsyncWork();
    });
    expect(screen.getByText("approval-b")).toBeTruthy();
  });

  it("collects choice and free-text answers in question order", async () => {
    const resolve = jest.fn(async () => undefined);
    const request: V2PendingRequest = {
      generation: "7",
      id: "input-a",
      kind: "userInput",
      questions: [
        {
          header: "Mode",
          id: "mode",
          isOther: false,
          isSecret: false,
          options: [
            { description: "Move quickly", label: "Fast" },
            { description: "Prefer guardrails", label: "Safe" },
          ],
          question: "Choose a mode",
        },
        {
          header: "",
          id: "note",
          isOther: true,
          isSecret: false,
          options: null,
          question: "Add a note",
        },
      ],
      threadId: "thread-a",
      turnId: "turn-a",
      itemId: "item-a",
    };
    renderPanel([request], resolve);

    expect(screen.getAllByLabelText("Voice input")).toHaveLength(2);
    fireEvent.press(screen.getByLabelText("Safe"));
    fireEvent.changeText(screen.getByLabelText("Answer Add a note"), "Keep the API small");
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Submit"));
      await flushAsyncWork();
    });

    expect(resolve).toHaveBeenCalledWith(serverId, request, {
      answers: [
        { answers: ["Safe"], questionId: "mode" },
        { answers: ["Keep the API small"], questionId: "note" },
      ],
      kind: "userInput",
    });
  });

  it("resolves requested permissions for the whole session", async () => {
    const resolve = jest.fn(async () => undefined);
    const request: V2PendingRequest = {
      generation: "5",
      id: "permission-a",
      itemId: "item-a",
      kind: "permissionApproval",
      permissions: {
        fileSystem: {
          entries: [],
          globScanMaxDepth: null,
          read: ["/workspace"],
          write: null,
        },
        network: { enabled: true },
      },
      reason: "Run the project checks",
      threadId: "thread-a",
      turnId: "turn-a",
    };
    renderPanel([request], resolve);

    await act(async () => {
      fireEvent.press(screen.getByLabelText("For session"));
      await flushAsyncWork();
    });

    expect(resolve).toHaveBeenCalledWith(serverId, request, {
      kind: "permissionApproval",
      permissions: request.permissions,
      scope: "session",
      strictAutoReview: false,
    });
  });

  it("does not invent a required-answer constraint absent from the V2 contract", async () => {
    const resolve = jest.fn(async () => undefined);
    const request: V2PendingRequest = {
      generation: "7",
      id: "input-a",
      kind: "userInput",
      questions: [
        {
          header: "",
          id: "optional-note",
          isOther: true,
          isSecret: false,
          options: null,
          question: "Optional note",
        },
      ],
      threadId: "thread-a",
      turnId: "turn-a",
      itemId: "item-a",
    };
    renderPanel([request], resolve);

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Submit"));
      await flushAsyncWork();
    });

    expect(resolve).toHaveBeenCalledWith(serverId, request, {
      answers: [{ answers: [""], questionId: "optional-note" }],
      kind: "userInput",
    });
  });

  it("validates and resolves elicitation fields without exposing secret text", async () => {
    const resolve = jest.fn(async () => undefined);
    const request: V2PendingRequest = {
      fields: [
        {
          defaultValue: { kind: "unset" },
          description: null,
          id: "token",
          label: "Token",
          options: null,
          required: true,
          type: "secret",
        },
        {
          defaultValue: { kind: "unset" },
          description: null,
          id: "enabled",
          label: "Enable feature",
          options: null,
          required: true,
          type: "boolean",
        },
      ],
      generation: "11",
      id: "elicitation-a",
      elicitationId: "tool-request-a",
      kind: "elicitation",
      message: "Provide tool settings",
      metadataJson: null,
      mode: "form",
      requestedSchemaJson: null,
      serverName: "Example tool",
      threadId: "thread-a",
      turnId: "turn-a",
      url: null,
    };
    renderPanel([request], resolve);

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Submit"));
      await flushAsyncWork();
    });
    expect(screen.getByText("Token is required")).toBeTruthy();
    expect(resolve).not.toHaveBeenCalled();

    const tokenInput = screen.getByLabelText("Answer Token");
    expect(tokenInput.props.secureTextEntry).toBe(true);
    expect(screen.queryByLabelText("Voice input")).toBeNull();
    fireEvent.changeText(tokenInput, "secret-value");
    fireEvent.press(screen.getByLabelText("Yes"));
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Submit"));
      await flushAsyncWork();
    });

    expect(resolve).toHaveBeenCalledWith(serverId, request, {
      contentJson: JSON.stringify({ token: "secret-value", enabled: true }),
      action: "accept",
      kind: "elicitation",
      metadataJson: null,
    });
  });

  it("initializes defaults, renders labeled choices, serializes arrays, and omits untouched optionals", async () => {
    const resolve = jest.fn(async () => undefined);
    const request: V2PendingRequest = {
      fields: [
        {
          defaultValue: { kind: "value", value: "prod" },
          description: null,
          id: "environment",
          label: "Environment",
          options: [
            { label: "Development", value: "dev" },
            { label: "Production", value: "prod" },
          ],
          required: true,
          type: "select",
        },
        {
          defaultValue: { kind: "value", value: ["stable"] },
          description: "Release channels",
          id: "channels",
          label: "Channels",
          options: [
            { label: "Stable", value: "stable" },
            { label: "Early access", value: "edge" },
          ],
          required: true,
          type: "array",
        },
        {
          defaultValue: { kind: "value", value: 2 },
          description: null,
          id: "replicas",
          label: "Replicas",
          options: null,
          required: false,
          type: "integer",
        },
        {
          defaultValue: { kind: "unset" },
          description: null,
          id: "note",
          label: "Optional note",
          options: null,
          required: false,
          type: "text",
        },
        {
          defaultValue: { kind: "value", value: null },
          description: null,
          id: "nullable",
          label: "Explicit null",
          options: null,
          required: false,
          type: "text",
        },
      ],
      generation: "11",
      id: "elicitation-defaults",
      elicitationId: "tool-request-defaults",
      kind: "elicitation",
      message: "Configure deployment",
      metadataJson: null,
      mode: "form",
      requestedSchemaJson: null,
      serverName: "Example tool",
      threadId: "thread-a",
      turnId: "turn-a",
      url: null,
    };
    renderPanel([request], resolve);

    expect(screen.getAllByLabelText("Voice input")).toHaveLength(2);
    expect(screen.getByLabelText("Production").props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText("Stable").props.accessibilityState.checked).toBe(true);
    expect(screen.getByLabelText("Answer Replicas").props.value).toBe("2");
    expect(screen.getByLabelText("Answer Optional note").props.value).toBe("");
    fireEvent.press(screen.getByLabelText("Early access"));
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Submit"));
      await flushAsyncWork();
    });

    expect(resolve).toHaveBeenCalledWith(serverId, request, {
      action: "accept",
      contentJson: JSON.stringify({
        environment: "prod",
        channels: ["stable", "edge"],
        replicas: 2,
        nullable: null,
      }),
      kind: "elicitation",
      metadataJson: null,
    });
  });

  it("validates and serializes comma-separated array input", async () => {
    const resolve = jest.fn(async () => undefined);
    const request: V2PendingRequest = {
      fields: [
        {
          defaultValue: { kind: "unset" },
          description: null,
          id: "targets",
          label: "Targets",
          options: null,
          required: true,
          type: "array",
        },
      ],
      generation: "11",
      id: "elicitation-array",
      elicitationId: null,
      kind: "elicitation",
      message: "Choose targets",
      metadataJson: null,
      mode: "form",
      requestedSchemaJson: null,
      serverName: "Example tool",
      threadId: "thread-a",
      turnId: "turn-a",
      url: null,
    };
    renderPanel([request], resolve);

    expect(screen.getByLabelText("Voice input")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Submit"));
      await flushAsyncWork();
    });
    expect(screen.getByText("Targets is required")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Answer Targets"), "api, worker");
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Submit"));
      await flushAsyncWork();
    });

    expect(resolve).toHaveBeenCalledWith(serverId, request, {
      action: "accept",
      contentJson: JSON.stringify({ targets: ["api", "worker"] }),
      kind: "elicitation",
      metadataJson: null,
    });
  });

  it("declines elicitation through the typed resolution", async () => {
    const resolve = jest.fn(async () => undefined);
    const request: V2PendingRequest = {
      fields: [],
      generation: "11",
      id: "elicitation-a",
      elicitationId: null,
      kind: "elicitation",
      message: "Continue?",
      metadataJson: null,
      mode: "form",
      requestedSchemaJson: null,
      serverName: "Example tool",
      threadId: "thread-a",
      turnId: "turn-a",
      url: null,
    };
    renderPanel([request], resolve);

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Decline"));
      await flushAsyncWork();
    });

    expect(resolve).toHaveBeenCalledWith(serverId, request, {
      action: "decline",
      contentJson: null,
      kind: "elicitation",
      metadataJson: null,
    });
  });

  it("opens a URL elicitation through the injected external-link capability", async () => {
    const resolve = jest.fn(async () => undefined);
    const openExternalLink = jest.fn(async () => undefined);
    const request: V2PendingRequest = {
      fields: [],
      generation: "11",
      id: "elicitation-url-a",
      elicitationId: "tool-request-a",
      kind: "elicitation",
      message: "Complete authorization in the browser",
      metadataJson: null,
      mode: "url",
      requestedSchemaJson: null,
      serverName: "Example tool",
      threadId: "thread-a",
      turnId: "turn-a",
      url: "https://example.test/authorize",
    };
    renderPanel([request], resolve, openExternalLink);

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Open secure form"));
      await flushAsyncWork();
    });

    expect(openExternalLink).toHaveBeenCalledWith("https://example.test/authorize");
    expect(screen.getByLabelText("Open secure form").props.accessibilityRole).toBe("link");
  });

  it("surfaces an injected URL-opening failure and unlocks the link", async () => {
    const request: V2PendingRequest = {
      fields: [],
      generation: "11",
      id: "elicitation-url-a",
      elicitationId: "tool-request-a",
      kind: "elicitation",
      message: "Complete authorization in the browser",
      metadataJson: null,
      mode: "url",
      requestedSchemaJson: null,
      serverName: "Example tool",
      threadId: "thread-a",
      turnId: "turn-a",
      url: "https://example.test/authorize",
    };
    renderPanel(
      [request],
      jest.fn(async () => undefined),
      jest.fn(async () => {
        throw new Error("private platform detail");
      }),
    );

    fireEvent.press(screen.getByLabelText("Open secure form"));

    expect(await screen.findByText("Could not open this link. Try again.")).toBeTruthy();
    expect(screen.getByLabelText("Open secure form").props.disabled).toBe(false);
  });

  it("surfaces resolution failure and permits retry", async () => {
    const resolve = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    renderPanel([approvalRequest("approval-a")], resolve);

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Decline"));
      await flushAsyncWork();
    });
    expect(await screen.findByText("Could not resolve request. Try again.")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Decline"));
      await flushAsyncWork();
    });

    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

function approvalRequest(id: string): V2PendingRequest {
  return {
    availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
    command: id,
    cwd: "/workspace",
    generation: "3",
    id,
    itemId: `item-${id}`,
    kind: "commandApproval",
    reason: null,
    threadId: "thread-a",
    turnId: "turn-a",
  };
}

function renderPanel(
  requests: readonly V2PendingRequest[],
  resolve: (...args: never[]) => Promise<void>,
  openExternalLink?: (url: string) => void | Promise<void>,
) {
  return render(panel(requests, resolve, openExternalLink));
}

function panel(
  requests: readonly V2PendingRequest[],
  resolve: (...args: never[]) => Promise<void>,
  openExternalLink?: (url: string) => void | Promise<void>,
) {
  const projection = new ObservableResource({
    operations: [],
    projections: {
      live: { sourceGeneration: "1" },
      retained: null,
    },
    state: "live" as const,
    version: 1,
  });
  const runtime = {
    requests: { resolve },
    sessions: { resource: () => projection },
    voice: new VoiceInputController({
      start: async () => ({ cancel: async () => undefined, finish: async () => undefined }),
    }),
  } as unknown as V2Runtime;
  return (
    <V2RuntimeProvider runtime={runtime}>
      <PendingRequestsPanel
        openExternalLink={openExternalLink}
        pendingRequests={requests}
        savedServerId={serverId}
        threadId="thread-a"
      />
    </V2RuntimeProvider>
  );
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
}
