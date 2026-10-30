import { act, fireEvent, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import type { EnrichedMarkdownTextInputProps } from "react-native-enriched-markdown";

import {
  renderScreen,
  type,
  unmountScreens,
  type Capabilities,
} from "./fixtures/pullRequestDetailsHarness";
import { resetAppDialog } from "./mocks/AppDialog";

// WHY: Expo's filesystem bridge cannot initialize in Node; the editor's suggestion popup imports it.
jest.mock("expo-file-system/legacy", () => ({ cacheDirectory: null }));

// WHY: The native Markdown editor requires Fabric. This adapter replaces only its platform view;
// typing is simulated through the same text and Markdown events the native editor emits.
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

// WHY: the native sheet window cannot mount in the Node renderer; the sheet's content is the contract here.
jest.mock("../src/ui/AppSheet", () => {
  const { View: MockView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppSheet: ({ children }: { readonly children: ReactNode }) => <MockView>{children}</MockView>,
    AppSheetScrollView: ({
      children,
      testID,
    }: {
      readonly children: ReactNode;
      readonly testID?: string;
    }) => <MockView testID={testID}>{children}</MockView>,
  };
});

beforeEach(() => {
  resetAppDialog();
});

afterEach(async () => {
  await unmountScreens();
});

it("orders Details as description, Changes, Status and the Conversation band with its count", async () => {
  const { view } = renderScreen({});
  // The band renders before the first page; wait for the loaded count, not just the band.
  await view.findByTestId("pull-request-discussion-heading-count");
  const heading = view.getByTestId("pull-request-discussion-heading");

  expect(within(heading).getByRole("header")).toHaveTextContent("Conversation");
  expect(within(heading).getByTestId("pull-request-discussion-heading-count")).toHaveTextContent(
    "6",
  );
  expect(heading).toHaveTextContent(/Newest first/u);
  const section = view.getByTestId("pull-request-conversation");
  expect(within(section).queryByTestId("pull-request-description")).toBeNull();
  const page = view.getByTestId("pull-request-overview");
  const order = within(page)
    .getAllByTestId(
      /^pull-request-(description|changes-band|status-band|conversation|open-changes)$/u,
    )
    .map((node) => String(node.props.testID));
  expect(order).toEqual([
    "pull-request-description",
    "pull-request-changes-band",
    "pull-request-open-changes",
    "pull-request-status-band",
    "pull-request-conversation",
  ]);
  // GitHub reports no issues, so there is no Issues row.
  expect(view.queryByTestId("pull-request-status-issues")).toBeNull();
});

it("summarizes reviews, checks and the merge state as Status rows", async () => {
  const { view } = renderScreen({});
  const reviews = await view.findByTestId("pull-request-status-reviews");

  expect(within(reviews).getByTestId("pull-request-status-reviews-detail")).toHaveTextContent(
    "mikhail-p requested changes",
  );
  expect(view.queryByTestId("pull-request-status-reviewer-mikhail-p")).toBeNull();
  fireEvent.press(within(reviews).getByTestId("pull-request-status-reviews-toggle"));
  expect(view.getByTestId("pull-request-status-reviewer-mikhail-p")).toHaveTextContent(
    /mikhail-p requested changes/u,
  );

  const checks = view.getByTestId("pull-request-status-checks");
  expect(within(checks).getByTestId("pull-request-status-checks-detail")).toHaveTextContent(
    "1 failing, 6 successful",
  );
  fireEvent.press(within(checks).getByTestId("pull-request-status-checks-toggle"));
  // Only the failing check is listed inline; passing ones stay in the sheet.
  expect(view.getByTestId("pull-request-status-check-c-android")).toHaveProp(
    "accessibilityLabel",
    "android / validate:android:v1, Failed after 3m 12s",
  );
  expect(view.queryByTestId("pull-request-status-check-c-companion")).toBeNull();
  expect(view.queryByTestId("pull-request-checks-sheet")).toBeNull();
  fireEvent.press(view.getByTestId("pull-request-status-checks-all"));
  expect(view.getByTestId("pull-request-checks-sheet")).toBeOnTheScreen();
  // The checks are summarized once: the merge state row keeps only the forge's reason.
  expect(view.getByTestId("pull-request-merge-box-state")).toHaveTextContent(
    /Merging is blocked.*1 required check is failing/u,
  );
  expect(view.queryByText("Some checks were not successful")).toBeNull();
});

it("publishes one comment from the composer sheet and closes it once acknowledged", async () => {
  let acknowledge: (() => void) | null = null;
  const createComment = jest.fn<
    ReturnType<Capabilities["createComment"]>,
    Parameters<Capabilities["createComment"]>
  >(
    async (_target, request) =>
      new Promise((resolve) => {
        acknowledge = () => {
          resolve({
            author: { avatarUrl: null, login: "sergeigarin" },
            body: request.body,
            createdAt: "2026-10-21T11:00:00Z",
            // WHY: the acknowledged comment is a fixture; the screen renders only its shape.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            id: "c-new" as never,
            reactions: [],
            updatedAt: null,
            url: null,
          });
        };
      }),
  );
  const { view } = renderScreen({ capabilityOverrides: { createComment } });

  expect(view.queryByTestId("pull-request-comment-sheet")).toBeNull();
  fireEvent.press(await view.findByTestId("pull-request-comment-button"));
  const composer = within(view.getByTestId("pull-request-comment-sheet"));
  type(composer, "Ship it");
  fireEvent.press(composer.getByTestId("pull-request-new-comment-send"));
  fireEvent.press(composer.getByTestId("pull-request-new-comment-send"));

  expect(createComment).toHaveBeenCalledTimes(1);
  expect(createComment.mock.calls[0]?.[1]).toMatchObject({ body: "Ship it" });
  expect(composer.getByTestId("pull-request-new-comment-pending")).toHaveTextContent("Ship it");

  await act(async () => {
    acknowledge?.();
    await Promise.resolve();
  });

  expect(view.queryByTestId("pull-request-comment-sheet")).toBeNull();
});

it("folds a long comment behind Read more until the reader unfolds it", async () => {
  const { view } = renderScreen({});
  const body = await view.findByTestId("conversation-comment-c-1-body");
  expect(view.queryByTestId("conversation-comment-c-1-read-more")).toBeNull();

  fireEvent(body, "layout", { nativeEvent: { layout: { height: 640, width: 360, x: 0, y: 0 } } });

  fireEvent.press(view.getByTestId("conversation-comment-c-1-read-more"));
  expect(view.queryByTestId("conversation-comment-c-1-read-more")).toBeNull();
  // A short comment never folds.
  fireEvent(view.getByTestId("conversation-comment-c-2-body"), "layout", {
    nativeEvent: { layout: { height: 40, width: 360, x: 0, y: 0 } },
  });
  expect(view.queryByTestId("conversation-comment-c-2-read-more")).toBeNull();
});
