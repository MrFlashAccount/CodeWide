import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { ServerRefreshButton } from "../src/features/connections/ServerRefreshButton";

describe("server refresh", () => {
  it("runs every server read once per press and ignores presses while they run", async () => {
    let finish = (): void => undefined;
    const pool = jest.fn(
      async () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const providers = jest.fn(async () => {
      throw new Error("offline");
    });
    render(<ServerRefreshButton refreshes={[pool, providers]} serverName="Buddy" />);
    fireEvent.press(screen.getByLabelText("Refresh Buddy"));
    fireEvent.press(screen.getByLabelText("Refresh Buddy"));
    expect(pool).toHaveBeenCalledTimes(1);
    expect(providers).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Refresh Buddy")).toBeDisabled();
    // A failed read does not end the others; the button settles when all do.
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Refresh Buddy")).toBeEnabled();
  });
});
