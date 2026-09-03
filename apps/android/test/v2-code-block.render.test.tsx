import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { setStringAsync } from "expo-clipboard";

import { CodeBlock } from "../src/v2/rendering/CodeBlock";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

const copy = jest.mocked(setStringAsync);

describe("V2 code block clipboard", () => {
  beforeEach(() => copy.mockReset());

  it("reports success only after the clipboard write resolves and suppresses duplicates", async () => {
    let resolveCopy: (() => void) | null = null;
    copy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    );
    render(<CodeBlock language="ts" value="const answer = 42;" />);

    fireEvent.press(screen.getByLabelText("Copy ts code block"));
    fireEvent.press(screen.getByLabelText("Copy ts code block"));
    expect(screen.getByText("Copying…")).toBeTruthy();
    expect(screen.queryByText("Copied")).toBeNull();
    expect(copy).toHaveBeenCalledTimes(1);

    await act(async () => resolveCopy?.());
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  it("shows an exact retry state when the clipboard rejects", async () => {
    copy.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    copy.mockResolvedValueOnce();
    render(<CodeBlock language="sh" value="pwd" />);

    await act(async () => fireEvent.press(screen.getByLabelText("Copy sh code block")));
    expect(screen.getByText("Copy failed · Retry")).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByLabelText("Copy sh code block")));
    expect(screen.getByText("Copied")).toBeTruthy();
    expect(copy).toHaveBeenCalledTimes(2);
  });
});
