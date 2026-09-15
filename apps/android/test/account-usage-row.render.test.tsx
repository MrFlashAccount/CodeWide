import { describe, expect, it } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Text } from "react-native";

import { AccountUsageRow } from "../src/features/accounts/AccountUsageRow";
import { colors } from "../src/theme";

describe("compact account usage row", () => {
  it("puts plan, reset icon, date and countdown in a single secondary line", () => {
    const view = render(<AccountUsageRow label="account@example.com" plan="Pro X 20" status="active" reset={{ absolute: "14 сент., 22:52", relative: "in 7d" }}><Text>100% left</Text></AccountUsageRow>);
    expect(view.getByText("account@example.com")).toBeTruthy();
    expect(view.getByText("100% left")).toBeTruthy();
    expect(view.getByLabelText("Pro X 20 · Resets 14 сент., 22:52 · in 7d")).toBeTruthy();
    expect(view.getByText("14 сент., 22:52").props.numberOfLines).toBe(1);
    expect(view.getByText("· in 7d").props.numberOfLines).toBe(1);
    expect(view.getByText("refresh-outline")).toBeTruthy();
    expect(view.queryByText(/active|Resets/u)).toBeNull();
  });

  it.each([
    ["active", colors.green], ["exhausted", colors.red], ["inactive", colors.textDim], ["disabled", colors.textDim],
  ] as const)("shows %s with an accessible status dot", (status, color) => {
    const view = render(<AccountUsageRow label="Account" plan="Plus" status={status} reset={null}><Text>Unavailable</Text></AccountUsageRow>);
    expect(view.getByLabelText(`Account ${status}`)).toHaveStyle({ backgroundColor: color });
    expect(view.getByText("Plus")).toBeTruthy();
    expect(view.queryByText("refresh-outline")).toBeNull();
  });
});
