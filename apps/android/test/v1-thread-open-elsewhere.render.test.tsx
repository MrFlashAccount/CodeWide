import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { ConversationBottomChrome } from "../src/features/conversation/ConversationBottomChrome";
import type { ConversationBottomChromeProps } from "../src/features/conversation/ConversationBottomChromeContract";
import { ThreadHeaderMenu } from "../src/features/turnActions/ThreadActions";
import { AppNoticeContext } from "../src/ui/appNoticeContext";
import { createV1TestThread } from "./fixtures/v1Thread";

const openElsewhereFailure = {
  acceptsInput: false,
  kind: "conversationOpenElsewhere" as const,
  message: "This conversation is open in another app. Close it there, then try again here.",
};

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function chrome({
  actions = { onCheckAgain: jest.fn(async () => undefined), onFork: jest.fn() },
  canAcceptDirectInput = false,
  parentThreadId = null,
}: {
  readonly actions?: ConversationBottomChromeProps["openElsewhereActions"];
  readonly canAcceptDirectInput?: boolean | null;
  readonly parentThreadId?: string | null;
} = {}) {
  const thread = {
    ...createV1TestThread("thread", null, 1, []),
    canAcceptDirectInput,
    parentThreadId,
  };
  return (
    <ConversationBottomChrome
      composerContent={<View testID="composer" />}
      currentOutcome={null}
      failureNotice={openElsewhereFailure}
      openElsewhereActions={actions}
      readOnly
      remoteThread={thread}
      reportBottomChromeHeight={jest.fn()}
      requestPrompt={null}
      timeline={[]}
    />
  );
}

describe("a conversation another app is running", () => {
  it("takes the editor's place under the composer and states the lock once", () => {
    render(chrome());
    expect(screen.getByTestId("thread-open-elsewhere-notice")).toHaveTextContent(
      /Open in another app/u,
    );
    expect(screen.getByTestId("composer")).toBeOnTheScreen();
    expect(screen.queryByTestId("thread-error-banner")).toBeNull();
  });

  it("explains the lock and both actions when the bar is pressed", () => {
    render(chrome());
    expect(screen.queryByTestId("thread-open-elsewhere-details")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Open in another app" }));
    expect(screen.getByTestId("thread-open-elsewhere-details")).toHaveTextContent(
      /sending is off until that app lets go.*Check again.*Fork/u,
    );
  });

  it("checks again until the read settles, then allows another check", async () => {
    const pending = deferred();
    const onCheckAgain = jest.fn(async () => pending.promise);
    render(chrome({ actions: { onCheckAgain, onFork: null } }));
    fireEvent.press(screen.getByRole("button", { name: "Check again" }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Check again" })).toBeDisabled();
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  });

  it("forks the chat only where the thread offers a fork", () => {
    const onFork = jest.fn();
    const { rerender } = render(chrome({ actions: { onCheckAgain: jest.fn(), onFork } }));
    fireEvent.press(screen.getByRole("button", { name: "Fork chat" }));
    expect(onFork).toHaveBeenCalledTimes(1);
    rerender(chrome({ actions: { onCheckAgain: jest.fn(), onFork: null } }));
    expect(screen.queryByRole("button", { name: "Fork chat" })).toBeNull();
  });

  it("is not claimed for a read-only thread whose input is merely unknown", () => {
    render(chrome({ canAcceptDirectInput: null }));
    expect(screen.queryByTestId("thread-open-elsewhere-notice")).toBeNull();
    expect(screen.getByTestId("thread-error-banner")).toBeOnTheScreen();
  });

  it("is not claimed for a sub-agent, which its parent agent drives", () => {
    render(chrome({ parentThreadId: "parent" }));
    expect(screen.queryByTestId("thread-open-elsewhere-notice")).toBeNull();
  });

  it("is not shown on a surface without its actions", () => {
    render(chrome({ actions: null }));
    expect(screen.queryByTestId("thread-open-elsewhere-notice")).toBeNull();
  });
});

function Wrapper(props: { readonly children: ReactNode }) {
  return (
    // WHY: the header reads the notice controller only for copy feedback, which these tests do not use.
    <AppNoticeContext.Provider value={{ show: jest.fn() } as never}>
      <View>{props.children}</View>
    </AppNoticeContext.Provider>
  );
}

describe("the thread menu of a conversation another app is running", () => {
  it("turns off only the actions that need the session", () => {
    render(
      <ThreadHeaderMenu
        archived={false}
        onArchive={jest.fn()}
        onCompact={jest.fn()}
        onDelete={jest.fn()}
        onRenameRequest={jest.fn()}
        onTogglePin={jest.fn()}
        openElsewhere
        pinned={false}
        threadId="thread"
      />,
      { wrapper: Wrapper },
    );
    fireEvent.press(screen.getAllByLabelText("Thread menu")[0]!);
    const state = (label: string) =>
      screen.getByLabelText(`Thread menu: ${label}`).props.accessibilityState?.disabled === true;
    expect(state("Compact context")).toBe(true);
    expect(state("Delete thread")).toBe(true);
    expect(state("Rename")).toBe(false);
    expect(state("Pin thread")).toBe(false);
    expect(state("Archive thread")).toBe(false);
  });
});
