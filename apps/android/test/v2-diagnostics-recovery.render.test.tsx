import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { PerformanceDiagnosticsFeature } from "../src/v2/features/diagnostics/PerformanceDiagnosticsFeature";
import { createDiagnosticsSource } from "../src/v2/features/diagnostics/diagnosticsSourceAdapters";
import type {
  DiagnosticsSource,
  NavigationProfile,
  PerformanceDiagnosticsSnapshot,
} from "../src/v2/features/diagnostics/diagnosticsTypes";
import {
  navigationHudSummary,
  serializeNavigationSpeedscopeProfile,
} from "../src/v2/features/diagnostics/navigationProfile";
import { RenderFailureFallback } from "../src/v2/ui/RenderFailureFallback";
import { createRenderRecoveryHandler } from "../src/v2/ui/renderRecoveryCapability";
import {
  renderRecoveryPrompt,
  type RecoverableRenderFailure,
} from "../src/v2/ui/renderRecoveryPrompt";

describe("V2 operational diagnostics and render recovery", () => {
  it("serializes ordered stages, sampled work, and visible states for Speedscope", () => {
    const profile = navigationProfile();
    const document = JSON.parse(serializeNavigationSpeedscopeProfile(profile)) as {
      exporter: string;
      profiles: { events?: { at: number }[]; name: string; type: string }[];
    };

    expect(document.exporter).toBe("CodeWide V2");
    expect(document.profiles.map((entry) => [entry.name, entry.type])).toEqual([
      ["Navigation stages", "evented"],
      ["Measured work", "sampled"],
      ["Visible UI states", "evented"],
    ]);
    expect(document.profiles[2]?.events?.map((entry) => entry.at)).toEqual([3, 3.01, 8, 8.01]);
    expect(navigationHudSummary(profile)).toContain("hot query 7 ms");
  });

  it("bounds repair context while preserving the recovery contract", () => {
    const prompt = renderRecoveryPrompt({
      componentStack: "S".repeat(9_000),
      context: "C".repeat(3_000),
      error: Object.assign(new Error("broken renderer"), { stack: "E".repeat(9_000) }),
      label: "Markdown response",
      scope: "bubble",
    });

    expect(prompt).toContain("CodeWide V2 Android client");
    expect(prompt).toContain("Surface: bubble / Markdown response");
    expect(prompt.match(/…truncated/g)).toHaveLength(3);
    expect(prompt).toContain("do not remove the error boundary");
  });

  it("offers retry and reports repair failures without losing the isolated fallback", async () => {
    const retry = jest.fn();
    const fix = jest.fn(async () => Promise.reject(new Error("repair unavailable")));

    render(<RenderFailureFallback failure={failure()} onFix={fix} onRetry={retry} />);
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    fireEvent.press(screen.getByRole("button", { name: "Fix this in chat" }));

    expect(retry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText("repair unavailable")).toBeTruthy());
    expect(screen.getByTestId("render-error-bubble")).toBeTruthy();
  });

  it("does not dismiss a modal after recovery navigates to its repair thread", async () => {
    const dismiss = jest.fn();
    const fix = jest.fn(async () => undefined);
    render(
      <RenderFailureFallback
        failure={{ ...failure(), scope: "dialog" }}
        onDismiss={dismiss}
        onFix={fix}
        onRetry={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByRole("button", { name: "Fix this in chat" }));
    await waitFor(() => expect(fix).toHaveBeenCalledTimes(1));

    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("adapts the injected metrics source and keeps native monitoring authoritative", async () => {
    const source = diagnosticsSource();
    render(<PerformanceDiagnosticsFeature source={source} />);

    expect(screen.getByText("Process CPU")).toBeTruthy();
    fireEvent(screen.getByLabelText("Enable performance data"), "valueChange", false);
    await waitFor(() => expect(source.setMonitoringEnabled).toHaveBeenCalledWith(false));
    fireEvent.press(screen.getByRole("button", { name: "Reset JS metrics" }));
    expect(source.reset).toHaveBeenCalledTimes(1);
  });

  it("joins V2 telemetry ports and releases their subscriptions", async () => {
    const fixture = diagnosticsAdapterFixture();
    const source = createDiagnosticsSource(fixture.input);
    const listener = jest.fn();
    const unsubscribe = source.subscribe(listener);

    fixture.publishNative();
    expect(listener).toHaveBeenCalledTimes(1);
    await source.setMonitoringEnabled(false);
    expect(fixture.setNativeEnabled).toHaveBeenCalledWith(false);
    expect(fixture.setOperationalEnabled).toHaveBeenCalledWith(false);
    expect(fixture.resetExperiments).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(fixture.upstreamUnsubscribes).toHaveLength(3);
    for (const upstreamUnsubscribe of fixture.upstreamUnsubscribes) {
      expect(upstreamUnsubscribe).toHaveBeenCalledTimes(1);
    }
  });

  it("builds a repair-chat request for the app-shell capability", async () => {
    const openRepairChat = jest.fn(async () => undefined);
    const recover = createRenderRecoveryHandler({
      context: () => "Thread: thread-a",
      openRepairChat,
    });

    await recover({ ...failure(), context: "Connection: server-a" });

    expect(openRepairChat).toHaveBeenCalledWith({
      prompt: expect.stringContaining("Connection: server-a\nThread: thread-a"),
      title: "Fix Markdown response",
    });
  });
});

function failure(): RecoverableRenderFailure {
  return {
    componentStack: "at MarkdownBubble",
    error: new Error("renderer failed"),
    label: "Markdown response",
    scope: "bubble",
  };
}

function navigationProfile(): NavigationProfile {
  return {
    bottleneckMs: 12,
    bottleneckStage: "timeline_model_ready",
    currentStage: "timeline_positioned",
    frames: { droppedFrameEstimate: 1, hermesProfile: null, jankFrames: 2 },
    id: "profile-a",
    measures: [record("query", 7)],
    rowCommits: 3,
    stages: [
      {
        elapsedMs: 5,
        name: "model",
        sincePreviousMs: 5,
        stage: "timeline_model_ready",
        tags: {},
        values: {},
      },
    ],
    status: "completed",
    threadId: "thread-a",
    totalMs: 20,
    uniqueRowsCommitted: 2,
    visualEvents: [visualRecord("second", 8), visualRecord("first", 3)],
  };
}

function record(name: string, durationMs: number): NavigationProfile["measures"][number] {
  return { durationMs, elapsedMs: durationMs, name, tags: {}, values: {} };
}

function visualRecord(name: string, elapsedMs: number): NavigationProfile["visualEvents"][number] {
  return { elapsedMs, name, tags: {}, values: {} };
}

function diagnosticsSource(): DiagnosticsSource & {
  reset: jest.Mock;
  setMonitoringEnabled: jest.Mock;
} {
  const snapshot: PerformanceDiagnosticsSnapshot = {
    experiments: {
      disableTextShimmer: false,
      hideThreadLists: false,
      plainTextMarkdown: false,
      reduceCustomMotion: false,
      skipMarkdownLayout: false,
    },
    native: {
      available: true,
      current: {
        averageFrameMs: 7,
        codePssBytes: 100,
        cpuPercent: 4,
        droppedFrameEstimate: 0,
        graphicsPssBytes: 100,
        jankPercent: 0,
        javaHeapBytes: 100,
        javaHeapLimitBytes: 200,
        javaHeapPssBytes: 100,
        nativeHeapBytes: 100,
        nativeHeapPssBytes: 100,
        p95FrameMs: 9,
        privateOtherPssBytes: 100,
        pssBytes: 1_024,
        renderedFps: 120,
        renderedFrames: 120,
        rssBytes: 2_048,
        rxBytesPerSecond: 10,
        rxSessionBytes: 20,
        sampledAtMs: 1,
        stackPssBytes: 100,
        systemPssBytes: 100,
        txBytesPerSecond: 10,
        txSessionBytes: 20,
        uptimeMs: 1_000,
      },
      enabled: true,
      historyCapacity: 60,
      historySamples: 1,
      peakCpuPercent: 4,
      peakPssBytes: 1_024,
      recent: [],
      sessionJankPercent: 0,
      totalDroppedFrameEstimate: 0,
    },
    operational: { counters: {}, gauges: {}, timings: {} },
  };
  return {
    copySnapshot: jest.fn(async () => undefined),
    reset: jest.fn(),
    runExperiment: jest.fn(async () => undefined),
    setExperiment: jest.fn(),
    setMonitoringEnabled: jest.fn(async () => undefined),
    snapshot: () => snapshot,
    subscribe: () => () => undefined,
  };
}

function diagnosticsAdapterFixture() {
  const snapshot = diagnosticsSource().snapshot();
  const upstreamUnsubscribes = [jest.fn(), jest.fn(), jest.fn()];
  let nativeListener: (() => void) | null = null;
  const setNativeEnabled = jest.fn(async () => undefined);
  const setOperationalEnabled = jest.fn();
  const resetExperiments = jest.fn();
  return {
    input: {
      copy: jest.fn(async () => undefined),
      experiments: {
        reset: resetExperiments,
        set: jest.fn(),
        snapshot: () => snapshot.experiments,
        subscribe: () => upstreamUnsubscribes[0]!,
      },
      native: {
        reset: jest.fn(),
        setEnabled: setNativeEnabled,
        snapshot: () => snapshot.native,
        subscribe: (listener: () => void) => {
          nativeListener = listener;
          return upstreamUnsubscribes[1]!;
        },
      },
      operational: {
        reset: jest.fn(),
        setEnabled: setOperationalEnabled,
        snapshot: () => snapshot.operational,
        subscribe: () => upstreamUnsubscribes[2]!,
      },
      runExperiment: jest.fn(async () => undefined),
    },
    publishNative(): void {
      nativeListener?.();
    },
    resetExperiments,
    setNativeEnabled,
    setOperationalEnabled,
    upstreamUnsubscribes,
  };
}
