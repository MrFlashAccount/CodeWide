import { fireEvent, render } from "@testing-library/react-native";
import { orchestrationToolCall } from "../src/features/conversation/protocol/orchestrationToolCall";
import { OrchestrationProtocolBlock } from "../src/features/conversation/protocol/OrchestrationProtocolBlock";
import { SubagentNavigationContext } from "../src/features/conversation/turns/turnContexts";

const child = "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d81";

function projected(raw: Record<string, unknown>, status: string | null) {
  const call = orchestrationToolCall(raw, status);
  if (call === null) throw new Error("not an orchestration tool");
  return call;
}

const spawn = projected(
  {
    arguments: { name: "reviewer", prompt: "Review the diff", provider: "codex" },
    contentItems: [
      {
        text: JSON.stringify({ agentThreadId: child, model: "gpt-5.5", provider: "codex", status: "running" }),
        type: "inputText",
      },
    ],
    id: "item-1",
    namespace: null,
    status: "completed",
    success: true,
    tool: "codewide_spawn_agent",
    type: "dynamicToolCall",
  },
  "completed",
);

it("renders a spawn call as a compact row that opens the child agent", () => {
  const open = jest.fn();
  const screen = render(
    <SubagentNavigationContext.Provider value={open}>
      <OrchestrationProtocolBlock call={spawn} />
    </SubagentNavigationContext.Provider>,
  );
  expect(screen.getByTestId("orchestration-tool-call")).toBeTruthy();
  expect(screen.getByText("Spawned Codex agent “reviewer”")).toBeTruthy();
  expect(screen.getByText("Review the diff")).toBeTruthy();
  expect(screen.getByText("gpt-5.5")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Spawned Codex agent “reviewer”. Open agent" }));
  expect(open).toHaveBeenCalledWith(child);
});

it("keeps the row without navigation when no subagent surface is available", () => {
  const screen = render(<OrchestrationProtocolBlock call={spawn} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("Spawned Codex agent “reviewer”")).toBeTruthy();
});

it("marks a failed call and shows its error", () => {
  const screen = render(
    <OrchestrationProtocolBlock
      call={projected(
        {
          arguments: { agentThreadId: child },
          contentItems: [{ text: "agent not found", type: "inputText" }],
          status: "failed",
          success: false,
          tool: "codewide_wait_agent",
        },
        "failed",
      )}
    />,
  );
  expect(screen.getByText("Could not wait for agent 0199a3c4")).toBeTruthy();
  expect(screen.getByText("agent not found")).toBeTruthy();
});
