import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { AttachmentListRow } from "../src/ui/AttachmentListRow";
import { listRowHeight } from "../src/ui/AppListRow.types";

it("keeps one fixed-height RN touch target across the attachment text and accessories", () => {
  const onPress = jest.fn();
  const view = render(
    <AttachmentListRow
      title="report.png"
      description="Codex · image"
      accessibilityLabel="Open attachment report.png"
      position="only"
      leading="image"
      trailing="open"
      onPress={onPress}
    />,
  );
  const row = view.getByRole("button", { name: "Open attachment report.png" });
  expect(view.getAllByRole("button")).toHaveLength(1);
  expect(StyleSheet.flatten(row.props.style).height).toBe(listRowHeight.double);
  expect(view.getByText("report.png").props.numberOfLines).toBe(1);
  expect(view.getByText("Codex · image").props.numberOfLines).toBe(1);
  fireEvent.press(view.getByText("report.png"));
  fireEvent.press(view.getByText("image-outline"));
  fireEvent.press(view.getByText("open-outline"));
  expect(onPress).toHaveBeenCalledTimes(3);
});

it("keeps long labels at the same row height without needing a trailing action", () => {
  const view = render(
    <AttachmentListRow
      title={"very-long-file-name".repeat(20)}
      description="You · file"
      accessibilityLabel="Open attachment"
      position="last"
      leading="file"
      onPress={jest.fn()}
    />,
  );
  const row = view.getByRole("button", { name: "Open attachment" });
  expect(StyleSheet.flatten(row.props.style).height).toBe(listRowHeight.double);
  expect(view.getByText("You · file")).toBeVisible();
});
