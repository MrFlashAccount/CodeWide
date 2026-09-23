import { render } from "@testing-library/react-native";
import { StyleSheet, View } from "react-native";
import { Bubble } from "../src/rendering/Bubble";
import { colors, radii, spacing } from "../src/theme";

function surface(segment?: "end" | "middle" | "start") {
  const view = render(
    <Bubble fill segment={segment} testID="surface" variant="agent">
      <View />
    </Bubble>,
  );
  const style = StyleSheet.flatten(view.getByTestId("surface").props.style);
  view.unmount();
  return style;
}

it("keeps the agent bubble inset uniform around its rounded corners", () => {
  expect(surface()).toMatchObject({
    backgroundColor: colors.messageSurface,
    borderRadius: radii.bubble,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  });
  expect(radii.bubble - radii.small).toBe(spacing.md);
});

it("uses the same corner and inset geometry for user bubbles", () => {
  const view = render(
    <Bubble testID="user-surface" variant="user">
      <View />
    </Bubble>,
  );
  expect(view.getByTestId("user-surface")).toHaveStyle({
    borderRadius: radii.bubble,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  });
});

it("composes experimental rows into the same continuous bubble surface", () => {
  expect(surface("start")).toMatchObject({
    backgroundColor: colors.messageSurface,
    borderRadius: 0,
    borderTopLeftRadius: radii.bubble,
    borderTopRightRadius: radii.bubble,
    paddingBottom: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  });
  expect(surface("middle")).toMatchObject({
    backgroundColor: colors.messageSurface,
    borderRadius: 0,
    paddingBottom: 0,
    paddingHorizontal: spacing.md,
    paddingTop: 0,
  });
  expect(surface("end")).toMatchObject({
    backgroundColor: colors.messageSurface,
    borderBottomLeftRadius: radii.bubble,
    borderBottomRightRadius: radii.bubble,
    borderRadius: 0,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: 0,
  });
});
