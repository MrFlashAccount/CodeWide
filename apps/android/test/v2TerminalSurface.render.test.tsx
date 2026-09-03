import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { View } from "react-native";

import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import type { TerminalSession } from "../src/v2/domain/terminalSession";
import { TerminalWorkspaceView } from "../src/v2/presentation/terminal/TerminalWorkspaceView";

const EXIT_FAILURE_CODE = 7;
const OWNER = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));

describe("V2 Terminal surface", () => {
  it("exposes live tabs and actual background processes", async () => {
    const onClose = jest.fn(async () => {
      await Promise.resolve();
    });
    const onTerminateBackground = jest.fn(async () => {
      await Promise.resolve();
    });
    const onSelect = jest.fn();
    const onToggleBackgrounds = jest.fn();
    render(
      <TerminalWorkspaceView
        activeTerminal={<View testID="active-terminal" />}
        activeSession={{
          cwd: "/workspace",
          error: null,
          errorCode: null,
          exitCode: null,
          id: "terminal-a",
          owner: OWNER,
          signal: null,
          status: "live",
          title: "Terminal 1",
        }}
        backgroundError={null}
        backgroundProcesses={[
          {
            command: "pnpm test",
            cpuPercent: 12.5,
            cwd: "/workspace",
            itemId: "item-a",
            osPid: "1234",
            processId: "process-a",
            rssKiB: "2048",
          },
        ]}
        backgroundStatus="ready"
        backgroundsVisible
        canCreate
        error={null}
        onClose={onClose}
        onCreate={() => undefined}
        onMinimize={() => undefined}
        onRefreshBackgrounds={() => undefined}
        onRetryReplay={async () => {
          await Promise.resolve();
        }}
        onSelect={onSelect}
        onTerminateBackground={onTerminateBackground}
        onToggleBackgrounds={onToggleBackgrounds}
        tabs={[
          {
            active: true,
            exitCode: null,
            id: "terminal-a",
            signal: null,
            status: "live",
            title: "Terminal 1",
          },
          {
            active: false,
            exitCode: null,
            id: "terminal-signal",
            signal: "SIGTERM",
            status: "closed",
            title: "Terminal 2",
          },
        ]}
      />,
    );

    fireEvent.press(screen.getByLabelText("Terminal 1"));
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Close Terminal 1"));
      await Promise.resolve();
    });
    fireEvent.press(screen.getByLabelText("Background processes: 1"));
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Terminate pnpm test"));
      await Promise.resolve();
    });

    expect(screen.getByTestId("active-terminal")).toBeTruthy();
    expect(screen.getByLabelText("Terminal 1").props.accessibilityValue).toEqual({ text: "Live" });
    expect(screen.getByLabelText("Terminal 2").props.accessibilityValue).toEqual({
      text: "Exited · SIGTERM",
    });
    expect(screen.getByTestId("v2-terminal-active-status").props.children).toBe("Live");
    expect(onSelect).toHaveBeenCalledWith("terminal-a");
    expect(onClose).toHaveBeenCalledWith("terminal-a");
    expect(onToggleBackgrounds).toHaveBeenCalledTimes(1);
    expect(onTerminateBackground).toHaveBeenCalledWith("process-a");
  });

  it("shows exact exit status and a stable retryable replay-loss state", async () => {
    const onRetryReplay = jest.fn(async () => {
      await Promise.resolve();
    });
    const activeSession: TerminalSession = {
      cwd: null,
      error: "Terminal replay unavailable",
      errorCode: "replayUnavailable",
      exitCode: null,
      id: "terminal-lost",
      owner: OWNER,
      signal: null,
      status: "failed",
      title: "Terminal 1",
    };
    const { rerender } = render(
      <TerminalWorkspaceView
        activeSession={activeSession}
        activeTerminal={<View testID="failed-terminal" />}
        backgroundError={null}
        backgroundProcesses={[]}
        backgroundStatus="ready"
        backgroundsVisible={false}
        canCreate
        error={null}
        onClose={async () => {
          await Promise.resolve();
        }}
        onCreate={() => undefined}
        onMinimize={() => undefined}
        onRefreshBackgrounds={() => undefined}
        onRetryReplay={onRetryReplay}
        onSelect={() => undefined}
        onTerminateBackground={async () => {
          await Promise.resolve();
        }}
        onToggleBackgrounds={() => undefined}
        tabs={[
          {
            active: true,
            exitCode: null,
            id: activeSession.id,
            signal: null,
            status: "failed",
            title: activeSession.title,
          },
        ]}
      />,
    );

    expect(screen.getByTestId("v2-terminal-replay-unavailable")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("v2-terminal-replay-retry"));
      await Promise.resolve();
    });
    expect(onRetryReplay).toHaveBeenCalledWith("terminal-lost");

    rerender(
      <TerminalWorkspaceView
        activeSession={{
          ...activeSession,
          error: null,
          errorCode: null,
          exitCode: EXIT_FAILURE_CODE,
          status: "closed",
        }}
        activeTerminal={<View testID="closed-terminal" />}
        backgroundError={null}
        backgroundProcesses={[]}
        backgroundStatus="ready"
        backgroundsVisible={false}
        canCreate
        error={null}
        onClose={async () => {
          await Promise.resolve();
        }}
        onCreate={() => undefined}
        onMinimize={() => undefined}
        onRefreshBackgrounds={() => undefined}
        onRetryReplay={onRetryReplay}
        onSelect={() => undefined}
        onTerminateBackground={async () => {
          await Promise.resolve();
        }}
        onToggleBackgrounds={() => undefined}
        tabs={[
          {
            active: true,
            exitCode: EXIT_FAILURE_CODE,
            id: activeSession.id,
            signal: null,
            status: "closed",
            title: activeSession.title,
          },
        ]}
      />,
    );
    expect(screen.getByLabelText("Terminal 1").props.accessibilityValue).toEqual({
      text: `Exited · code ${String(EXIT_FAILURE_CODE)}`,
    });
    expect(screen.getByTestId("v2-terminal-active-status").props.children).toBe(
      `Exited · code ${String(EXIT_FAILURE_CODE)}`,
    );
  });

  it("deduplicates create taps and exposes the exact failure with retry", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const onCreate = jest
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    render(
      <TerminalWorkspaceView
        activeSession={null}
        activeTerminal={null}
        backgroundError={null}
        backgroundProcesses={[]}
        backgroundStatus="ready"
        backgroundsVisible={false}
        canCreate
        error={null}
        onClose={() => Promise.resolve()}
        onCreate={onCreate}
        onMinimize={() => undefined}
        onRefreshBackgrounds={() => undefined}
        onRetryReplay={() => Promise.resolve()}
        onSelect={() => undefined}
        onTerminateBackground={() => Promise.resolve()}
        onToggleBackgrounds={() => undefined}
        tabs={[]}
      />,
    );

    fireEvent.press(screen.getByLabelText("Open terminal"));
    fireEvent.press(screen.getByLabelText("Open terminal"));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("v2-terminal-action-feedback-pending").props.accessibilityLabel).toBe(
      "Opening terminal…",
    );

    await act(async () => {
      first.reject(new Error("Companion denied terminal"));
      await first.promise.catch(() => undefined);
    });
    await waitFor(() => {
      expect(screen.getByText("Companion denied terminal")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("v2-terminal-action-feedback-retry"));
    expect(onCreate).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("v2-terminal-action-feedback-pending").props.accessibilityLabel).toBe(
      "Opening terminal…",
    );
    await act(async () => {
      second.resolve(undefined);
      await second.promise;
    });
    await waitFor(() => {
      expect(screen.queryByTestId("v2-terminal-action-feedback")).toBeNull();
    });
  });

  it("deduplicates replay and close taps with action-specific pending state", async () => {
    const replay = deferred<void>();
    const close = deferred<void>();
    const onRetryReplay = jest.fn(() => replay.promise);
    const onClose = jest.fn(() => close.promise);
    const activeSession: TerminalSession = {
      cwd: null,
      error: "Terminal replay unavailable",
      errorCode: "replayUnavailable",
      exitCode: null,
      id: "terminal-lost",
      owner: OWNER,
      signal: null,
      status: "failed",
      title: "Terminal 1",
    };
    const common = {
      backgroundError: null,
      backgroundProcesses: [],
      backgroundStatus: "ready" as const,
      backgroundsVisible: false,
      canCreate: true,
      error: null,
      onClose,
      onCreate: () => Promise.resolve(),
      onMinimize: () => undefined,
      onRefreshBackgrounds: () => undefined,
      onRetryReplay,
      onSelect: () => undefined,
      onTerminateBackground: () => Promise.resolve(),
      onToggleBackgrounds: () => undefined,
      tabs: [
        {
          active: true,
          exitCode: null,
          id: activeSession.id,
          signal: null,
          status: "failed" as const,
          title: activeSession.title,
        },
      ],
    };
    const { rerender } = render(
      <TerminalWorkspaceView
        {...common}
        activeSession={activeSession}
        activeTerminal={<View testID="failed-terminal" />}
      />,
    );

    fireEvent.press(screen.getByTestId("v2-terminal-replay-retry"));
    fireEvent.press(screen.getByTestId("v2-terminal-replay-retry"));
    expect(onRetryReplay).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("v2-terminal-action-feedback-pending").props.accessibilityLabel).toBe(
      "Starting new terminal…",
    );
    await act(async () => {
      replay.resolve(undefined);
      await replay.promise;
    });
    await waitFor(() => {
      expect(screen.queryByTestId("v2-terminal-action-feedback")).toBeNull();
    });

    rerender(
      <TerminalWorkspaceView
        {...common}
        activeSession={{ ...activeSession, error: null, errorCode: null, status: "live" }}
        activeTerminal={<View testID="live-terminal" />}
        tabs={[{ ...common.tabs[0], status: "live" }]}
      />,
    );
    fireEvent.press(screen.getByLabelText("Close Terminal 1"));
    fireEvent.press(screen.getByLabelText("Close Terminal 1"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(
        screen.getByTestId("v2-terminal-action-feedback-pending").props.accessibilityLabel,
      ).toBe("Closing Terminal 1…");
    });
    await act(async () => {
      close.resolve(undefined);
      await close.promise;
    });
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  reject(cause: unknown): void;
  resolve(value: T): void;
} {
  let reject = (_cause: unknown): void => undefined;
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>((accept, decline) => {
    reject = decline;
    resolve = accept;
  });
  return { promise, reject, resolve };
}
