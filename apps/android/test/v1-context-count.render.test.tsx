import { render } from "@testing-library/react-native";

import { ComposerContextCount } from "../src/ui/ResourceContextChip";
import { AppText } from "../src/ui/AppText";

it("truncates only the name, in the middle, and keeps the count whole", () => {
  const branch = "fix/a-very-long-branch-name-that-cannot-fit-in-one-chip";
  const screen = render(
    <ComposerContextCount label={branch} testID="composer-changes-label" value={0} />,
  );
  const name = screen.getByText(branch);
  expect(name.props.numberOfLines).toBe(1);
  expect(name.props.ellipsizeMode).toBe("middle");
  expect(screen.getByTestId("composer-changes-label")).toHaveTextContent(`${branch} · 0`);
  expect(screen.getByLabelText(`${branch} · 0`)).toBeVisible();
  expect(screen.UNSAFE_getAllByType(AppText).some((node) => node.props.shimmering === true)).toBe(
    false,
  );
});

it("keeps the name and count in place while a refresh is pending", () => {
  const screen = render(
    <ComposerContextCount
      label="Attachments"
      loading
      testID="composer-attachments-label"
      value={3}
    />,
  );
  const chip = screen.getByTestId("composer-attachments-label");
  expect(chip).toHaveTextContent("Attachments · 3");
  expect(chip).toBeBusy();
  const texts = screen.UNSAFE_getAllByType(AppText);
  expect(texts.length).toBeGreaterThan(0);
  expect(texts.every((node) => node.props.shimmering === true)).toBe(true);
});
