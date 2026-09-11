import { describe, expect, it } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";

import { SessionUsageDetails } from "../src/ui/SessionUsageDetails";

const tokens = { input: 8475604, cached: 8000412, output: 39332, total: 8514936 };
const cost = { input: 10.45, cached: 0.8, output: 1.97, total: 12.42 };

describe("session usage details", () => {
  it("pairs compact token counts and costs, preserving exact accessible counts", () => {
    const view = render(<SessionUsageDetails tokens={tokens} cost={cost} compactionCount={2} />);
    expect(view.getByText("Tokens")).toBeTruthy();
    expect(view.getByText("Est. cost")).toBeTruthy();
    for (const [label, count] of [["Input", tokens.input], ["Cached", tokens.cached], ["Output", tokens.output], ["Total", tokens.total]] as const) {
      expect(view.getByLabelText(`${label}: ${count.toLocaleString()} tokens`)).toBeTruthy();
    }
    expect(view.getByLabelText("$10.45")).toBeTruthy();
    expect(view.getByLabelText("$0.800")).toBeTruthy();
    expect(view.getByLabelText("$1.97")).toBeTruthy();
    expect(view.getByLabelText("$12.42")).toBeTruthy();
    expect(view.getByLabelText("2 compactions")).toBeTruthy();
  });

  it("keeps the estimate caveat visible and discloses its full limitations on demand", () => {
    const view = render(<SessionUsageDetails tokens={tokens} cost={cost} compactionCount={null} />);
    expect(view.getByText("API estimate · current model prices")).toBeTruthy();
    expect(view.getByLabelText("Compaction count unavailable: history not loaded")).toBeTruthy();
    expect(view.queryByText(/Model switches/)).toBeNull();
    fireEvent.press(view.getByRole("button", { name: "About the cost estimate" }));
    expect(view.getByText(/Model switches and per-request long-context premiums are not reconstructed/)).toBeTruthy();
    fireEvent.press(view.getByRole("button", { name: "About the cost estimate" }));
    expect(view.queryByText(/Model switches/)).toBeNull();
  });

  it("does not present missing prices or history as zero", () => {
    const view = render(<SessionUsageDetails tokens={tokens} cost={null} compactionCount={null} />);
    expect(view.getByLabelText("Input cost unavailable")).toBeTruthy();
    expect(view.getByLabelText("Cached cost unavailable")).toBeTruthy();
    expect(view.getByLabelText("Output cost unavailable")).toBeTruthy();
    expect(view.getByLabelText("Total cost unavailable")).toBeTruthy();
    expect(view.getByText("Cost unavailable for the current model.")).toBeTruthy();
    expect(view.queryByRole("button")).toBeNull();
    view.rerender(<SessionUsageDetails tokens={null} cost={null} compactionCount={0} />);
    expect(view.getByText("Token usage unavailable")).toBeTruthy();
    expect(view.getByLabelText("0 compactions")).toBeTruthy();
  });
});
