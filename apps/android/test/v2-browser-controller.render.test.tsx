import { act, renderHook } from "@testing-library/react-native";

import type { BrowserDevToolsCapability } from "../src/v2/application/ports/browserDevTools";
import { useInternalBrowserController } from "../src/v2/infrastructure/react/useInternalBrowserController";

const mockProtocol = {
  apply: jest.fn(),
  findInspectablePage: jest.fn(),
  restore: jest.fn(),
};

jest.mock("../src/v2/infrastructure/ports/browserDevToolsProtocol", () => ({
  chromiumDevToolsUrl: jest.fn(() => "http://127.0.0.1:41237/devtools"),
  findInspectablePage: (...arguments_: unknown[]) =>
    mockProtocol.findInspectablePage(...arguments_),
  markInspectablePage: jest.fn(() => ({
    apply: mockProtocol.apply,
    id: "target-marker",
    restore: mockProtocol.restore,
  })),
}));

describe("V2 internal browser controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stops native tracing when the browser route unmounts", async () => {
    const startTracing = jest.fn().mockResolvedValue(undefined);
    const stopTracing = jest.fn().mockResolvedValue({ path: "/trace.json", size: 10 });
    const capability: BrowserDevToolsCapability = {
      start: jest.fn().mockResolvedValue({
        host: "127.0.0.1",
        port: 41_237,
        token: "a".repeat(64),
        tracingSupported: true,
      }),
      startTracing,
      stop: jest.fn(),
      stopTracing,
    };
    const rendered = renderHook(() =>
      useInternalBrowserController({
        capability,
        onClose: jest.fn(),
        pageUrl: "http://127.0.0.1:3000/",
      }),
    );

    await act(async () => rendered.result.current.toggleTrace());
    expect(startTracing).toHaveBeenCalledTimes(1);

    rendered.unmount();
    expect(stopTracing).toHaveBeenCalledTimes(1);
  });

  it("restores the page marker, stops the bridge, and clears loading after discovery fails", async () => {
    const stop = jest.fn();
    mockProtocol.findInspectablePage.mockRejectedValueOnce(new Error("Discovery failed"));
    const capability: BrowserDevToolsCapability = {
      start: jest.fn().mockResolvedValue({
        host: "127.0.0.1",
        port: 41_237,
        token: "a".repeat(64),
        tracingSupported: true,
      }),
      startTracing: jest.fn().mockResolvedValue(undefined),
      stop,
      stopTracing: jest.fn().mockResolvedValue({ path: "/trace.json", size: 10 }),
    };
    const rendered = renderHook(() =>
      useInternalBrowserController({
        capability,
        onClose: jest.fn(),
        pageUrl: "http://127.0.0.1:3000/",
      }),
    );

    await act(async () => rendered.result.current.openDevTools());

    expect(mockProtocol.apply).toHaveBeenCalledTimes(1);
    expect(mockProtocol.restore).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(rendered.result.current.devToolsLoading).toBe(false);
    expect(rendered.result.current.devToolsDocumentLoading).toBe(false);
    expect(rendered.result.current.devToolsError).toBe("Discovery failed");
  });
});
