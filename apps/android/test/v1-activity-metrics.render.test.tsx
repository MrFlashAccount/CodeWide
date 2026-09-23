import { render } from "@testing-library/react-native";
import { OutputFootprintMetric } from "../src/features/conversation/protocol/CommandOutput";
import { TurnActivity } from "../src/features/conversation/turns/TurnActivity";
import { turnActivityLabel } from "../src/features/conversation/turns/turnProjection";
import { parseActivityMetrics } from "@codewide/sync-client";

const footprint = {
  version: 1 as const,
  basis: "approxBytesPerToken" as const,
  bytes: 4,
  estimatedTokens: 137,
  estimatedInputCostUsd: 0.125,
};

it("renders the server count, tokens and price verbatim apart from display formatting", () => {
  const metrics = parseActivityMetrics({version: 1, total: { count: 58, kinds: ["commandExecution"], outputFootprint: footprint }, ranges: [], commands: {}});
  if (metrics === null) throw new Error("invalid fixture");
  const view = render(<TurnActivity expanded={false} label={turnActivityLabel(metrics.total.kinds, true, metrics.total.count)} onToggle={() => undefined} outputFootprint={metrics.total.outputFootprint}>{null}</TurnActivity>);
  expect(view.getByText("ran commands · 58")).toBeTruthy();
  expect(view.getByLabelText(/137 tokens.*\$0.125/)).toBeTruthy();
});

it("updates server figures and hides unknown prices without inventing a price", () => {
  const view = render(<OutputFootprintMetric footprint={footprint} />);
  view.rerender(<OutputFootprintMetric footprint={{...footprint, estimatedTokens: 901, estimatedInputCostUsd: null}} />);
  expect(view.getByLabelText("Estimated command output footprint 901 tokens")).toBeTruthy();
  expect(view.queryByText(/\$/)).toBeNull();
  view.rerender(<OutputFootprintMetric footprint={null} />);
  expect(view.queryByLabelText(/Estimated command output footprint/)).toBeNull();
});
