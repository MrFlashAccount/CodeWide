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

it("keeps the ordinary agent bubble geometry unchanged", () => {
  expect(surface()).toMatchObject({
    backgroundColor: colors.messageSurface,
    borderRadius: radii.selected,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  });
});

it("composes experimental rows into the same continuous bubble surface", () => {
  expect(surface("start")).toMatchObject({
    backgroundColor: colors.messageSurface,
    borderRadius: 0,
    borderTopLeftRadius: radii.selected,
    borderTopRightRadius: radii.selected,
    paddingBottom: 0,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  });
  expect(surface("middle")).toMatchObject({
    backgroundColor: colors.messageSurface,
    borderRadius: 0,
    paddingBottom: 0,
    paddingHorizontal: spacing.sm,
    paddingTop: 0,
  });
  expect(surface("end")).toMatchObject({
    backgroundColor: colors.messageSurface,
    borderBottomLeftRadius: radii.selected,
    borderBottomRightRadius: radii.selected,
    borderRadius: 0,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingTop: 0,
  });
});
