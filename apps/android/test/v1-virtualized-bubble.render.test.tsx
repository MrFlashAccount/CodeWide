import { render } from "@testing-library/react-native";
import { StyleSheet, View } from "react-native";
import { Card } from "../src/features/conversation/turns/Card";
import { TurnActivity } from "../src/features/conversation/turns/TurnActivity";
import { Bubble, BubbleContent } from "../src/rendering/Bubble";
import { colors, radii, spacing } from "../src/theme";
import { AppText as Text } from "../src/ui/Typography";

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
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
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
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  });
});

it("keeps outer vertical rhythm on the bubble instead of stacking nested activity insets", () => {
  const result = render(
    <Bubble testID="activity-bubble" variant="agent">
      <BubbleContent>
        <TurnActivity expanded label="Tools" onToggle={() => {}} showToggle={false}>
          <Card icon="terminal-outline" title="Command">
            <Text>Output</Text>
          </Card>
        </TurnActivity>
      </BubbleContent>
    </Bubble>,
  );

  expect(result.getByTestId("activity-bubble")).toHaveStyle({
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  });
  expect(result.getByTestId("turn-activity")).toHaveStyle({ marginTop: 0 });
  expect(result.getByTestId("turn-activity-list")).toHaveStyle({
    gap: spacing.xxs,
    paddingBottom: 0,
    paddingTop: 0,
  });
  expect(result.getByTestId("protocol-card")).toHaveStyle({
    paddingBottom: 0,
    paddingTop: 0,
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
    paddingTop: spacing.sm,
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
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: 0,
  });
});
