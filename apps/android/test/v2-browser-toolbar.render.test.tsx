import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { BrowserToolbar } from "../src/v2/presentation/browser/BrowserToolbar";

describe("V2 internal browser toolbar", () => {
  it("exposes close, history, reload and real DevTools actions", async () => {
    const close = jest.fn();
    const goBack = jest.fn();
    const goForward = jest.fn();
    const reload = jest.fn();
    const openDevTools = jest.fn().mockResolvedValue(undefined);
    const toggleTrace = jest.fn().mockResolvedValue(undefined);
    const screen = render(
      <BrowserToolbar
        canGoBack
        canGoForward
        closeDevTools={jest.fn()}
        devToolsLoading={false}
        devToolsOpen={false}
        goBack={goBack}
        goForward={goForward}
        location="http://127.0.0.1:3000/app"
        onClose={close}
        openDevTools={openDevTools}
        reload={reload}
        status="Live"
        title="App"
        toggleTrace={toggleTrace}
        traceRunning={false}
        traceStatus={null}
        traceSupported
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Close browser"));
      fireEvent.press(screen.getByLabelText("Back"));
      fireEvent.press(screen.getByLabelText("Forward"));
      fireEvent.press(screen.getByLabelText("Reload"));
      fireEvent.press(screen.getByLabelText("Open Chromium DevTools"));
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(goForward).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(openDevTools).toHaveBeenCalledTimes(1);
  });

  it("locks duplicate async presses until success resolves", async () => {
    const pending = deferred<void>();
    const openDevTools = jest.fn(() => pending.promise);
    renderToolbar({ openDevTools });

    fireEvent.press(screen.getByLabelText("Open Chromium DevTools"));
    fireEvent.press(screen.getByLabelText("Open Chromium DevTools"));

    expect(openDevTools).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Opening Chromium DevTools…")).toBeTruthy();
    expect(screen.getByLabelText("Open Chromium DevTools").props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
      selected: false,
    });

    await act(async () => pending.resolve());
    expect(screen.queryByText("Opening Chromium DevTools…")).toBeNull();
  });

  it("shows the exact rejection and retries the same browser action", async () => {
    const openDevTools = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Chromium inspection lease expired"))
      .mockResolvedValueOnce(undefined);
    renderToolbar({ openDevTools });

    fireEvent.press(screen.getByLabelText("Open Chromium DevTools"));
    await screen.findByText("Chromium inspection lease expired");
    fireEvent.press(screen.getByLabelText("Retry failed action"));
    await act(async () => undefined);

    expect(openDevTools).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Chromium inspection lease expired")).toBeNull();
  });

  it("disables unavailable navigation actions", () => {
    const goBack = jest.fn();
    const goForward = jest.fn();
    const screen = render(
      <BrowserToolbar
        canGoBack={false}
        canGoForward={false}
        closeDevTools={jest.fn()}
        devToolsLoading={false}
        devToolsOpen={false}
        goBack={goBack}
        goForward={goForward}
        location="about:blank"
        onClose={jest.fn()}
        openDevTools={jest.fn().mockResolvedValue(undefined)}
        reload={jest.fn()}
        status="Bounded"
        title="Preview"
        toggleTrace={jest.fn().mockResolvedValue(undefined)}
        traceRunning={false}
        traceStatus={null}
        traceSupported={false}
      />,
    );

    fireEvent.press(screen.getByLabelText("Back"));
    fireEvent.press(screen.getByLabelText("Forward"));

    expect(goBack).not.toHaveBeenCalled();
    expect(goForward).not.toHaveBeenCalled();
  });
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

interface RenderToolbarInput {
  openDevTools: () => Promise<void>;
}

function renderToolbar(input: RenderToolbarInput): ReturnType<typeof render> {
  return render(
    <BrowserToolbar
      canGoBack={false}
      canGoForward={false}
      closeDevTools={jest.fn()}
      devToolsLoading={false}
      devToolsOpen={false}
      goBack={jest.fn()}
      goForward={jest.fn()}
      location="http://127.0.0.1:3000"
      onClose={jest.fn()}
      openDevTools={input.openDevTools}
      reload={jest.fn()}
      status="Live"
      title="App"
      toggleTrace={jest.fn().mockResolvedValue(undefined)}
      traceRunning={false}
      traceStatus={null}
      traceSupported
    />,
  );
}
