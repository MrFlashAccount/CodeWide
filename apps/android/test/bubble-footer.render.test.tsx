import { fireEvent, render, within } from "@testing-library/react-native";
import { Text, View } from "react-native";
import { Bubble, BubbleContent, useInsideBubbleSurface } from "../src/rendering/Bubble";
import { MessageFooterRow, MessageFooterStatus } from "../src/rendering/MessageFooterRow";
import { spacing, typeScale } from "../src/theme";

function BubbleSurfaceProbe({ testID }: { testID: string }) {
  return <Text testID={testID}>{useInsideBubbleSurface() ? "inside" : "outside"}</Text>;
}

it("marks nested bubble content without changing content rendered elsewhere", () => {
  const result = render(
    <View>
      <BubbleSurfaceProbe testID="outside-bubble" />
      <Bubble variant="agent">
        <BubbleContent><BubbleSurfaceProbe testID="inside-bubble" /></BubbleContent>
      </Bubble>
    </View>,
  );
  expect(result.getByTestId("outside-bubble")).toHaveTextContent("outside");
  expect(result.getByTestId("inside-bubble")).toHaveTextContent("inside");
});

it("keeps the footer closer to its own bubble than to the following message", () => {
  const result = render(
    <View>
      <Bubble variant="agent" testID="answer" footer={<MessageFooterRow time="15:28"><Text>Completed</Text></MessageFooterRow>}>
        <Text>Answer</Text>
      </Bubble>
      <Bubble variant="user" testID="next-message"><Text>Next question</Text></Bubble>
    </View>,
  );
  expect(result.getByTestId("agent-bubble-frame")).toHaveStyle({ gap: spacing.optical, marginBottom: spacing.xs });
  expect(result.getByTestId("turn-footer")).toHaveStyle({ minHeight: typeScale.label.lineHeight, paddingVertical: spacing.optical });
  expect(spacing.optical * 2).toBeLessThan(spacing.xs);
  expect(result.getByTestId("next-message")).toBeVisible();

  result.rerender(<View><Bubble variant="agent" testID="answer"><Text>No footer</Text></Bubble></View>);
  expect(result.getByTestId("agent-bubble-frame")).not.toHaveStyle({ marginBottom: spacing.xs });
});

it("keeps metadata and the running status on one line", () => {
  const result = render(
    <View style={{ width: 180 }}>
      <MessageFooterRow time="15:28">
        <MessageFooterStatus><Text testID="indicator">◌</Text><Text numberOfLines={1}>Running</Text></MessageFooterStatus>
        <Text>815K tokens</Text>
      </MessageFooterRow>
    </View>,
  );
  const status = result.getByTestId("turn-footer-status");
  expect(status).toHaveStyle({ flexDirection: "row", flexShrink: 0 });
  expect(within(status).getByText("Running")).toBeVisible();
  expect(within(status).getByTestId("indicator")).toBeVisible();
  expect(result.getByTestId("turn-footer-metadata")).toHaveStyle({ flexWrap: "nowrap" });
  expect(result.getByTestId("turn-footer-time")).toHaveStyle({ flexShrink: 0 });
  const timeAnchor = result.getByTestId("turn-footer-time-anchor");
  expect(timeAnchor).toHaveStyle({ marginLeft: "auto", paddingLeft: spacing.sm });
  expect(within(timeAnchor).queryByText("·")).toBeNull();
});

it("hides tokens before cost, preserves Changes and time, and restores details when space returns", () => {
  const result = render(<MessageFooterRow time="15:28" tokens={<Text>815K tokens</Text>} cost={<Text>$1.20</Text>} changes={<Text>Changes</Text>}>
    <MessageFooterStatus><Text>●</Text><Text>3s</Text></MessageFooterStatus>
  </MessageFooterRow>);
  const layout = (id: string, width: number) => fireEvent(result.getByTestId(id), "layout", { nativeEvent: { layout: { width, height: 16, x: 0, y: 0 } } });
  layout("turn-footer", 400);
  layout("turn-footer-primary-segment", 70);
  layout("turn-footer-tokens-segment", 100);
  layout("turn-footer-cost-segment", 60);
  layout("turn-footer-changes-segment", 70);
  layout("turn-footer-time-segment", 50);
  expect(result.getByText("815K tokens")).toBeVisible();
  expect(result.getByText("$1.20")).toBeVisible();
  layout("turn-footer", 280);
  expect(result.queryByText("815K tokens")).toBeNull();
  expect(result.getByText("$1.20")).toBeVisible();
  layout("turn-footer", 220);
  expect(result.queryByText("$1.20")).toBeNull();
  expect(result.getByText("Changes")).toBeVisible();
  expect(result.getByText("15:28")).toBeVisible();
  layout("turn-footer", 400);
  expect(result.getByText("815K tokens")).toBeVisible();
  expect(result.getByText("$1.20")).toBeVisible();
});

it("gives an agent body and footer the same intrinsic-width owner", () => {
  const footer = <MessageFooterRow time="11:05 PM"><Text>Completed · 2s · 42K tokens</Text></MessageFooterRow>;
  const result = render(<Bubble variant="agent" testID="answer" footer={footer}><Text>OK</Text></Bubble>);
  const frame = result.getByTestId("agent-bubble-frame");
  expect(frame).toHaveStyle({ maxWidth: "100%", alignSelf: "flex-start", flexShrink: 1 });
  expect(frame).not.toHaveStyle({ width: "100%" });
  expect(within(frame).getByTestId("answer")).toHaveStyle({ alignSelf: "stretch" });
  expect(within(frame).getByTestId("turn-footer")).toHaveStyle({ alignSelf: "stretch" });
  // An auto flex basis preserves metadata's intrinsic contribution to the column width.
  expect(result.getByTestId("turn-footer-metadata")).not.toHaveStyle({ flex: 1 });
  result.rerender(<Bubble variant="agent" fill testID="answer" footer={footer}><Text>Code or table</Text></Bubble>);
  expect(result.getByTestId("agent-bubble-frame")).toHaveStyle({ flexGrow: 1, flexBasis: 0 });
  expect(result.getByTestId("answer")).toHaveStyle({ alignSelf: "stretch" });
  expect(result.getByTestId("turn-footer-time").props.numberOfLines).toBe(1);
});

it("leaves user bubble sizing independent of the agent footer", () => {
  const result = render(<Bubble variant="user" testID="user"><Text>Hello</Text></Bubble>);
  expect(result.queryByTestId("agent-bubble-frame")).toBeNull();
  expect(result.getByTestId("user")).toHaveStyle({ maxWidth: "82%", alignSelf: "flex-end" });
});
