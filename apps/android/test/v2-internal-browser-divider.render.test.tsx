import { act, fireEvent, render } from "@testing-library/react-native";
import {
  PanResponder,
  StyleSheet,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";

import {
  InternalBrowserView,
  type InternalBrowserViewProps,
} from "../src/v2/presentation/browser/InternalBrowserView";

describe("V2 internal browser divider", () => {
  it("keeps one responder while resizing with the latest dock direction", () => {
    const originalCreate = PanResponder.create.bind(PanResponder);
    let callbacks: Parameters<typeof PanResponder.create>[0] | null = null;
    const create = jest.spyOn(PanResponder, "create").mockImplementation((value) => {
      callbacks = value;
      return originalCreate(value);
    });
    const screen = render(<InternalBrowserView {...browserProps("right")} />);
    fireEvent(screen.getByTestId("browser-split-content"), "layout", layoutEvent(1_000, 600));

    act(() => {
      callbacks?.onPanResponderGrant?.(responderEvent(), gesture(0, 0));
      callbacks?.onPanResponderMove?.(responderEvent(), gesture(100, 0));
    });
    expect(targetStyle(screen.getByTestId("browser-target-pane").props.style)).toMatchObject({
      width: "60%",
    });

    screen.rerender(<InternalBrowserView {...browserProps("left")} />);
    act(() => {
      callbacks?.onPanResponderGrant?.(responderEvent(), gesture(0, 0));
      callbacks?.onPanResponderMove?.(responderEvent(), gesture(100, 0));
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(targetStyle(screen.getByTestId("browser-target-pane").props.style)).toMatchObject({
      width: "50%",
    });
  });
});

function browserProps(devToolsDockSide: "left" | "right"): InternalBrowserViewProps {
  return {
    closeDevTools: jest.fn(),
    devToolsBootstrap: "",
    devToolsDockSide,
    devToolsDocumentLoading: false,
    devToolsError: null,
    devToolsLoading: false,
    devToolsUrl: "http://127.0.0.1:9222/devtools",
    goBack: jest.fn(),
    goForward: jest.fn(),
    healthProbe: "",
    navigation: { canGoBack: false, canGoForward: false, url: "http://127.0.0.1:3000" },
    onClose: jest.fn(),
    onDevToolsError: jest.fn(),
    onDevToolsLoadStart: jest.fn(),
    onDevToolsMessage: jest.fn(),
    onError: jest.fn(),
    onHttpError: jest.fn(),
    onNavigation: jest.fn(),
    onRendererGone: jest.fn(),
    openDevTools: jest.fn().mockResolvedValue(undefined),
    reload: jest.fn(),
    retryDevTools: jest.fn(),
    setBrowserRef: jest.fn(),
    setDevToolsRef: jest.fn(),
    source: { headers: null, uri: "http://127.0.0.1:3000" },
    status: "Live",
    title: "App",
    toggleTrace: jest.fn().mockResolvedValue(undefined),
    traceRunning: false,
    traceStatus: null,
    traceSupported: true,
  };
}

function gesture(dx: number, dy: number): PanResponderGestureState {
  return {
    _accountsForMovesUpTo: 0,
    dx,
    dy,
    moveX: dx,
    moveY: dy,
    numberActiveTouches: 1,
    stateID: 1,
    vx: 0,
    vy: 0,
    x0: 0,
    y0: 0,
  };
}

function layoutEvent(width: number, height: number) {
  return { nativeEvent: { layout: { height, width, x: 0, y: 0 } } };
}

function responderEvent(): GestureResponderEvent {
  return {} as GestureResponderEvent;
}

function targetStyle(value: unknown): Record<string, unknown> {
  return StyleSheet.flatten(value as never) as Record<string, unknown>;
}
