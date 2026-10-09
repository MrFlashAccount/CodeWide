import { fireEvent, render } from "@testing-library/react-native";
import { ComposerAccessoryTray } from "../src/features/composer/ComposerAccessoryTray";
import { ApprovalPrompt } from "../src/features/requests/RequestFeature";
import type { PendingServerRequest } from "../src/data/pending-request-types";
import { ThreadRowContent } from "../src/features/threadList/ThreadRowContent";
import { parseAgentProviderId } from "../src/data/threadAgent";
import { ModelPickerOptions } from "../src/ui/ModelPickerOptions";

function approval(params: Record<string, unknown>): PendingServerRequest {
  return {
    connectionId: "server", requestKey: "request", requestId: 1,
    method: "item/commandExecution/requestApproval", params,
    state: "pending", createdAt: 0,
  };
}

it("titles a non-command tool approval with the server-provided title", () => {
  const screen = render(
    <ApprovalPrompt
      onRespond={jest.fn()}
      request={approval({ codewideApprovalTitle: "Fetch https://example.com", reason: "Needs the page" })}
      requestCount={1}
    />,
  );
  expect(screen.getByText("Fetch https://example.com")).toBeOnTheScreen();
  expect(screen.queryByText("Command approval")).toBeNull();
  expect(screen.getByText("Needs the page")).toBeOnTheScreen();
});

it("keeps the method-derived title without a server title", () => {
  const screen = render(
    <ApprovalPrompt onRespond={jest.fn()} request={approval({ command: "make" })} requestCount={1} />,
  );
  expect(screen.getByText("Command approval")).toBeOnTheScreen();
});

it("disables the skill entry when the thread's agent does not accept skills", () => {
  const select = jest.fn();
  const screen = render(
    <ComposerAccessoryTray fileEnabled goalEnabled={false} onSelect={select} skillsEnabled={false} terminalEnabled />,
  );
  fireEvent.press(screen.getByLabelText("Skill"));
  fireEvent.press(screen.getByLabelText("Goal"));
  expect(select).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Skill")).toBeDisabled();
  fireEvent.press(screen.getByLabelText("File"));
  expect(select).toHaveBeenCalledWith("files");
});

it("shows the provider badge only on rows that carry one", () => {
  const thread = { id: "t", pinned: false, preview: "Preview", serverId: "server", title: "Title", unread: 0, timestamp: 1 };
  const badged = render(
    <ThreadRowContent selected={false} server={undefined} thread={{ ...thread, agentBadge: "Claude", agentProvider: "claude" }} />,
  );
  const badge = badged.getByTestId("thread-agent-badge");
  // Icon only: the provider name is the accessibility label, never visible text.
  expect(badge).toHaveAccessibleName("Agent Claude");
  expect(badge).not.toHaveTextContent("Claude");
  expect(badged.queryByText("Claude")).toBeNull();
  expect(badged.getByTestId("provider-icon-claude", { includeHiddenElements: true })).toBeTruthy();
  const plain = render(<ThreadRowContent selected={false} server={undefined} thread={thread} />);
  expect(plain.queryByTestId("thread-agent-badge")).toBeNull();
});

it("marks provider-aware model rows with their provider and keeps a legacy catalog plain", () => {
  const model = { defaultEffort: "high", efforts: ["high"], isDefault: false, supportsPersonality: false };
  const claude = parseAgentProviderId("claude");
  const codex = parseAgentProviderId("codex");
  if (claude === null || codex === null) throw new Error("invalid provider fixture");
  const picker = render(
    <ModelPickerOptions
      models={[
        { ...model, id: "gpt-5.5", label: "GPT-5.5", provider: codex },
        { ...model, id: "claude-opus", label: "Claude · Opus", provider: claude },
        { ...model, id: "unknown-model", label: "Other · Model", provider: parseAgentProviderId("gemini") },
      ]}
      onSelect={jest.fn()}
      selectedModel="gpt-5.5"
    />,
  );
  expect(picker.getByTestId("provider-icon-codex", { includeHiddenElements: true })).toBeTruthy();
  expect(picker.getByTestId("provider-icon-claude", { includeHiddenElements: true })).toBeTruthy();
  // An unknown provider falls back to the generic mark instead of another provider's brand.
  expect(picker.getByTestId("provider-icon-generic", { includeHiddenElements: true })).toBeTruthy();
  const legacy = render(
    <ModelPickerOptions
      models={[{ ...model, id: "gpt-5.5", label: "GPT-5.5", provider: null }]}
      onSelect={jest.fn()}
      selectedModel={null}
    />,
  );
  expect(legacy.queryByTestId(/^provider-icon-/u, { includeHiddenElements: true })).toBeNull();
});
