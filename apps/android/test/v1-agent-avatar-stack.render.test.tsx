import { render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { ReactTestInstance } from "react-test-renderer";
import { AgentAvatarStack, type AgentAvatarSubject } from "../src/ui/AgentAvatar";

const SURFACE = "#2a2a2a";

const subjects: readonly AgentAvatarSubject[] = [
  { kind: "command", name: "First" },
  { kind: "command", name: "Second" },
  { kind: "command", name: "Third" },
];

/** The z-order of the stack slot holding an avatar: its nearest ancestor with a zIndex. */
function stackLayer(avatar: ReactTestInstance): number {
  for (let node = avatar.parent; node !== null; node = node.parent) {
    const zIndex = StyleSheet.flatten(node.props.style)?.zIndex;
    if (typeof zIndex === "number") {
      return zIndex;
    }
  }
  throw new Error("The avatar is not in a stack slot");
}

function renderStack() {
  return render(
    <AgentAvatarStack
      badgeOf={() => "done"}
      keyOf={(subject) => subject.name}
      subjects={subjects}
      surface={SURFACE}
    />,
  );
}

it("draws the earliest avatar on top of the later ones", () => {
  const view = renderStack();

  const layers = view.getAllByTestId("agent-avatar").map(stackLayer);

  expect(layers).toHaveLength(subjects.length);
  expect(layers).toEqual([...layers].sort((a, b) => b - a));
  expect(new Set(layers).size).toBe(subjects.length);
});

it("rings each avatar in the color of the surface under it, not a dark outline", () => {
  const view = renderStack();

  for (const avatar of view.getAllByTestId("agent-avatar")) {
    expect(avatar).toHaveStyle({ borderColor: SURFACE });
  }
});
