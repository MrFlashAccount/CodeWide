import { Ionicons } from "@expo/vector-icons";
import { fireEvent, render, within } from "@testing-library/react-native";

import { OverflowMenu } from "../src/ui/OverflowMenu";
import { OverflowMenuButton } from "../src/ui/OverflowMenuButton";

const ACTIONS = [
  { id: "rename", label: "Rename" },
  { id: "delete", destructive: true, label: "Delete" },
] as const;

it("opens the actions menu from a labelled vertical-dots button and runs the chosen action", () => {
  const select = jest.fn();
  const view = render(
    <OverflowMenu accessibilityLabel="Actions for Repo" actions={ACTIONS} onSelect={select} />,
  );
  const trigger = view.getByRole("button", { name: "Actions for Repo" });
  expect(within(trigger).UNSAFE_getByType(Ionicons).props.name).toBe("ellipsis-vertical");
  expect(view.queryByLabelText("Actions for Repo: Delete")).toBeNull();

  fireEvent.press(trigger);
  fireEvent.press(view.getByLabelText("Actions for Repo: Delete"));

  expect(select).toHaveBeenCalledWith("delete");
  expect(select).toHaveBeenCalledTimes(1);
});

it("does not open the menu while the trigger is busy", () => {
  const view = render(
    <OverflowMenu
      accessibilityLabel="Changes options"
      actions={ACTIONS}
      busy
      onSelect={jest.fn()}
    />,
  );
  const trigger = view.getByRole("button", { name: "Changes options" });
  expect(trigger).toBeDisabled();
  expect(within(trigger).UNSAFE_queryByType(Ionicons)).toBeNull();

  fireEvent.press(trigger);

  expect(view.queryByLabelText("Changes options: Rename")).toBeNull();
});

it("lets another menu owner open the menu from the bare trigger", () => {
  const open = jest.fn();
  const view = render(<OverflowMenuButton accessibilityLabel="Message actions" onPress={open} />);
  const trigger = view.getByRole("button", { name: "Message actions" });
  expect(within(trigger).UNSAFE_getByType(Ionicons).props.name).toBe("ellipsis-vertical");

  fireEvent.press(trigger);

  expect(open).toHaveBeenCalledTimes(1);
});
