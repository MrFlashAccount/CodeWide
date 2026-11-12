import { RpcResponseError } from "@codewide/sync-client";
import { act, fireEvent, waitFor, within } from "@testing-library/react-native";
import type { EnrichedMarkdownTextInputProps } from "react-native-enriched-markdown";

import { conversation91 } from "./fixtures/forgeWireFixtures";
import {
  PULL_REQUEST,
  renderScreen,
  unmountScreens,
  type Capabilities,
} from "./fixtures/pullRequestDetailsHarness";
import { getAppDialogRequest, resetAppDialog } from "./mocks/AppDialog";

// WHY: Expo's filesystem bridge cannot initialize in Node; the editor's suggestion popup imports it.
jest.mock("expo-file-system/legacy", () => ({ cacheDirectory: null }));

// WHY: The native Markdown editor requires Fabric; the reply input mounts it inside every open thread.
jest.mock("react-native-enriched-markdown", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    EnrichedMarkdownTextInput: React.forwardRef(function Editor(
      props: EnrichedMarkdownTextInputProps,
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({
        focus: jest.fn(),
        getMarkdown: async () => Promise.resolve(""),
        setSelection: jest.fn(),
        setValue: jest.fn(),
      }));
      return <View {...props} testID="native-editor" />;
    }),
  };
});

const RESOLVE = "forge.conversation.resolve@1";

const COMMITS = {
  items: [
    {
      authorLogin: "dana",
      sha: "1".repeat(40),
      shortSha: "1111111",
      title: "Map stderr to AuthRequired",
    },
    { authorLogin: null, sha: "2".repeat(40), shortSha: null, title: "Keep the host hint" },
  ],
  total: 5,
};

/** #91 with a code excerpt and a toggle on `rt-1`, a toggle on settled `rt-2` and commits on `e-1`. */
function enriched(toggle: boolean): unknown {
  return {
    ...conversation91,
    entries: conversation91.entries.map((entry) => {
      if (entry.kind === "event") {
        return { ...entry, commits: COMMITS };
      }
      if (entry.kind !== "reviewThread" || !("thread" in entry)) {
        return entry;
      }
      const { thread } = entry;
      return {
        ...entry,
        thread: {
          ...thread,
          ...(thread.id === "rt-1"
            ? {
                excerpt: {
                  lines: [
                    { kind: "context", newLine: 212, oldLine: 210, text: "let child = command" },
                    { kind: "removed", oldLine: 211, text: "    .stderr(Stdio::null())" },
                    { kind: "added", newLine: 213, text: "    .stderr(Stdio::piped())" },
                    { kind: "added", newLine: 214, text: "    .spawn()?;" },
                  ],
                },
              }
            : {}),
          resolution: { ...thread.resolution, viewerCanToggle: toggle },
        },
      };
    }),
  };
}

type Resolve = jest.Mock<
  ReturnType<Capabilities["resolveReviewThread"]>,
  Parameters<Capabilities["resolveReviewThread"]>
>;

beforeEach(() => {
  resetAppDialog();
});

afterEach(async () => {
  await unmountScreens();
});

it("draws the code excerpt with both line numbers, marks the anchored line and folds with the thread", async () => {
  const { view } = renderScreen({ conversation: enriched(false) });
  const excerpt = await view.findByTestId("review-thread-rt-1-excerpt");

  expect(excerpt.props.accessibilityLabel).toBe(
    "Code at crates/companion-core/src/vcs/plugin.rs lines 212 to 214",
  );
  const code = within(excerpt);
  expect(code.getByTestId("review-thread-rt-1-excerpt-line-0")).toHaveTextContent(
    "210212  let child = command",
  );
  expect(code.getByTestId("review-thread-rt-1-excerpt-line-1")).toHaveTextContent(
    "211- .stderr(Stdio::null())",
  );
  // Only the line the thread is written on is marked.
  expect(code.getByTestId("review-thread-rt-1-excerpt-line-3-anchored")).toHaveTextContent(
    "214+ .spawn()?;",
  );
  expect(code.queryAllByTestId(/-anchored$/u)).toHaveLength(1);

  fireEvent.press(view.getByTestId("review-thread-rt-1-toggle"));
  expect(view.queryByTestId("review-thread-rt-1-excerpt")).toBeNull();
});

it("offers Resolve only with the declared capability and the forge's permission", async () => {
  const undeclared = renderScreen({ conversation: enriched(true) });
  await undeclared.view.findByTestId("review-thread-rt-1-excerpt");
  expect(undeclared.view.queryByTestId("review-thread-rt-1-resolve")).toBeNull();
  await unmountScreens();

  const forbidden = renderScreen({ conversation: enriched(false), extraCapabilities: [RESOLVE] });
  await forbidden.view.findByTestId("review-thread-rt-1-excerpt");
  expect(forbidden.view.queryByTestId("review-thread-rt-1-resolve")).toBeNull();
  await unmountScreens();

  const { view } = renderScreen({ conversation: enriched(true), extraCapabilities: [RESOLVE] });
  expect(await view.findByTestId("review-thread-rt-1-resolve")).toHaveAccessibleName(
    "Resolve conversation",
  );
  // The settled thread starts folded; open, it offers to unresolve.
  fireEvent.press(view.getByTestId("review-thread-rt-2-toggle"));
  expect(view.getByTestId("review-thread-rt-2-resolve")).toHaveAccessibleName(
    "Unresolve conversation",
  );
});

it("resolves once, keeping the label while pending, then folds the thread", async () => {
  let acknowledge: (() => void) | null = null;
  const resolveReviewThread: Resolve = jest.fn(
    async () =>
      new Promise((resolve) => {
        acknowledge = () => {
          resolve({ resolved: true, viewerCanToggle: true });
        };
      }),
  );
  const { view } = renderScreen({
    capabilityOverrides: { resolveReviewThread },
    conversation: enriched(true),
    extraCapabilities: [RESOLVE],
  });
  const button = await view.findByTestId("review-thread-rt-1-resolve");

  fireEvent.press(button);
  fireEvent.press(view.getByTestId("review-thread-rt-1-resolve"));

  expect(resolveReviewThread).toHaveBeenCalledTimes(1);
  const [target, request] = resolveReviewThread.mock.calls[0] ?? [];
  expect(target).toEqual({ connectionId: "server", pullRequest: PULL_REQUEST });
  expect(request).toMatchObject({ resolved: true, threadId: "rt-1" });
  expect(request?.idempotencyKey).toEqual(expect.any(String));
  const pending = view.getByTestId("review-thread-rt-1-resolve");
  // The label stays in place as the shimmer target; no progress words replace it.
  expect(within(pending).getByText("Resolve conversation")).toBeOnTheScreen();
  expect(pending).toBeDisabled();

  await act(async () => {
    acknowledge?.();
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(view.queryByTestId("review-thread-rt-1-excerpt")).toBeNull();
  });
  expect(view.getByTestId("review-thread-rt-1-toggle").props.accessibilityState).toEqual({
    expanded: false,
  });
});

it("shows the forge's reason and lets the user try again when resolving fails", async () => {
  const resolveReviewThread: Resolve = jest.fn(async () =>
    Promise.reject(new RpcResponseError(-32_083, "The forge refused to resolve")),
  );
  const { view } = renderScreen({
    capabilityOverrides: { resolveReviewThread },
    conversation: enriched(true),
    extraCapabilities: [RESOLVE],
  });

  fireEvent.press(await view.findByTestId("review-thread-rt-1-resolve"));

  expect(await view.findByTestId("review-thread-rt-1-resolve-error")).toHaveTextContent(
    "The forge refused to resolve",
  );
  const button = view.getByTestId("review-thread-rt-1-resolve");
  expect(button).toBeEnabled();
  expect(button).toHaveAccessibleName("Resolve conversation");
  // The thread stays open with its code.
  expect(view.getByTestId("review-thread-rt-1-excerpt")).toBeOnTheScreen();
});

it("refuses to resolve locally while the companion is offline", async () => {
  const resolveReviewThread: Resolve = jest.fn();
  const { server, view } = renderScreen({
    capabilityOverrides: { resolveReviewThread },
    conversation: enriched(true),
    extraCapabilities: [RESOLVE],
  });
  const button = await view.findByTestId("review-thread-rt-1-resolve");
  server.goOffline();
  await act(async () => {
    if (PULL_REQUEST !== null) {
      await server.forge.overviews
        .refresh({ connectionId: "server", pullRequest: PULL_REQUEST })
        .catch(() => undefined);
    }
  });
  // TanStack delivers the failed refresh to the mounted observer on its next tick.
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });

  await act(async () => {
    fireEvent.press(button);
    await Promise.resolve();
  });

  expect(getAppDialogRequest()?.title).toBe("The companion is offline");
  expect(resolveReviewThread).not.toHaveBeenCalled();
  expect(view.getByTestId("review-thread-rt-1-resolve")).toBeEnabled();
});

it("lists a push's commits under its row with how many more it had", async () => {
  const { view } = renderScreen({ conversation: enriched(false) });
  const commits = within(await view.findByTestId("conversation-event-e-1-commits"));

  expect(commits.getByTestId(`conversation-event-e-1-commits-${"1".repeat(40)}`)).toHaveTextContent(
    "1111111Map stderr to AuthRequired",
  );
  // Without the forge's short id the first seven characters stand in.
  expect(commits.getByTestId(`conversation-event-e-1-commits-${"2".repeat(40)}`)).toHaveTextContent(
    "2222222Keep the host hint",
  );
  expect(commits.getByTestId("conversation-event-e-1-commits-more")).toHaveTextContent(
    "and 3 more commits",
  );
});
