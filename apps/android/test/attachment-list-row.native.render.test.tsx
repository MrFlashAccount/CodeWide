import { fireEvent, render } from "@testing-library/react-native";

import { AttachmentListRow } from "../src/ui/AttachmentListRow.android";
import { listRowHeight } from "../src/ui/AppListRow.types";

it("keeps fixed cell geometry, synchronous icons and a labelled action", () => {
  const onPress = jest.fn();
  const view = render(
    <AttachmentListRow
      title="photo.png"
      description="You · image"
      accessibilityLabel="Open attachment photo.png"
      leading="image"
      trailing="open"
      position="only"
      onPress={onPress}
    />,
  );
  expect(view.getByRole("button", { name: "Open attachment photo.png" })).toHaveStyle({
    height: listRowHeight.double,
  });
  expect(view.getByText("photo.png").props.numberOfLines).toBe(1);
  expect(view.getByText("You · image").props.numberOfLines).toBe(1);
  expect(view.getByText("image-outline")).toBeVisible();
  expect(view.getByText("open-outline")).toBeVisible();
  fireEvent.press(view.getByText("photo.png"));
  fireEvent.press(view.getByText("image-outline"));
  expect(onPress).toHaveBeenCalledTimes(2);
});

it("rebinds the action and all display data when LegendList recycles a cell", () => {
  const first = jest.fn();
  const second = jest.fn();
  const view = render(
    <AttachmentListRow
      title="first.png"
      description="You · image"
      accessibilityLabel="First"
      leading="image"
      trailing="open"
      position="first"
      onPress={first}
    />,
  );
  fireEvent.press(view.getByRole("button", { name: "First" }));
  view.rerender(
    <AttachmentListRow
      title="second.mp3"
      description="Codex · audio"
      accessibilityLabel="Second"
      leading="audio"
      position="last"
      onPress={second}
    />,
  );
  expect(view.queryByText("first.png")).toBeNull();
  expect(view.queryByText("You · image")).toBeNull();
  expect(view.getByText("Codex · audio")).toBeVisible();
  expect(view.queryByText("image-outline")).toBeNull();
  expect(view.getByText("musical-note-outline")).toBeVisible();
  expect(view.queryByText("open-outline")).toBeNull();
  fireEvent.press(view.getByRole("button", { name: "Second" }));
  fireEvent.press(view.getByText("musical-note-outline"));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
});
