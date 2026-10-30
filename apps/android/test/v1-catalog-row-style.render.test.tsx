import { render, within } from "@testing-library/react-native";
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";

import { parsePullRequestListPage } from "../src/data/forgePullRequestContract";
import { PullRequestRow } from "../src/features/pullRequests/list/PullRequestRow";
import { ThreadRowContent } from "../src/features/threadList/ThreadRowContent";
import { ThreadRowLinkTrigger } from "../src/features/threadList/ThreadRowLinkTrigger";
import { threadListRowHeight } from "../src/features/threadList/threadListModel";
import { typeScale, typeWeight } from "../src/theme";
import { productFontStyle } from "../src/ui/AppText";
import { reviewRequestedPage } from "./fixtures/forgeWireFixtures";

// Threads and Pull requests are sibling catalogs: Sergey's contract is that their
// rows share one size and one typographic hierarchy, owned by ui/CatalogRow.

const TYPOGRAPHY_KEYS = ["color", "fontFamily", "fontSize", "fontWeight", "lineHeight"] as const;

/** A type role as AppText renders it: size and line height, weight resolved to a product font. */
function rendered(role: TextStyle): TextStyle {
  return {
    fontSize: role.fontSize,
    lineHeight: role.lineHeight,
    ...productFontStyle(role),
  };
}
const FRAME_KEYS = [
  "borderRadius",
  "height",
  "marginHorizontal",
  "marginVertical",
  "paddingHorizontal",
  "paddingVertical",
] as const;

function pick<Style extends object>(style: Style, keys: readonly (keyof Style)[]): Partial<Style> {
  return Object.fromEntries(keys.map((key) => [key, style[key]]));
}

function textStyle(element: { readonly props: { readonly style?: unknown } }): TextStyle {
  // WHY: host Text props carry the authored StyleProp<TextStyle>; flatten resolves it.
  return StyleSheet.flatten(element.props.style as TextStyle);
}

function viewStyle(element: { readonly props: { readonly style?: unknown } }): ViewStyle {
  // WHY: host View props carry the authored StyleProp<ViewStyle>; flatten resolves it.
  return StyleSheet.flatten(element.props.style as ViewStyle);
}

function pullRequestRow() {
  const row = parsePullRequestListPage(reviewRequestedPage)?.sections[0]?.rows[0];
  if (row === undefined) {
    throw new Error("The pull-request fixture is invalid");
  }
  return row;
}

function renderThreadRow() {
  return render(
    <ThreadRowLinkTrigger
      onLongPress={() => undefined}
      selected={false}
      swipeEnabled={false}
      testID="thread-row-frame"
    >
      <ThreadRowContent
        selected={false}
        thread={{
          id: "thread",
          pinned: false,
          preview: "Preview",
          serverId: "server",
          time: "2m",
          title: "Thread",
          unread: 1,
        }}
      />
    </ThreadRowLinkTrigger>,
  );
}

function renderPullRequestRow() {
  const row = pullRequestRow();
  return {
    row,
    view: render(
      <PullRequestRow
        icon={null}
        nowMs={Date.parse(row.updatedAt) + 60_000}
        onPress={() => undefined}
        row={row}
      />,
    ),
  };
}

it("renders thread and pull-request titles and subtitles in the same type roles", () => {
  const thread = renderThreadRow();
  const threadTitle = textStyle(thread.getByTestId("catalog-row-title"));
  const threadSubtitle = textStyle(thread.getByTestId("thread-preview"));
  const threadAge = textStyle(thread.getByTestId("thread-time"));
  const threadMarker = viewStyle(thread.getByLabelText("Unread thread"));
  thread.unmount();

  const { row, view } = renderPullRequestRow();
  const pullRequest = within(view.getByTestId(`pull-request-row-${row.number}`));
  const pullRequestTitle = textStyle(pullRequest.getByTestId("catalog-row-title"));
  const pullRequestSubtitle = textStyle(pullRequest.getByTestId("catalog-row-subtitle"));
  const pullRequestAge = textStyle(pullRequest.getByTestId("catalog-row-age"));
  const pullRequestMarker = viewStyle(pullRequest.getByLabelText("New activity"));

  expect(pullRequest.getByText(row.title)).toBeOnTheScreen();
  expect(threadTitle).toMatchObject(
    rendered({ ...typeScale.body, fontWeight: typeWeight.semibold }),
  );
  expect(threadSubtitle).toMatchObject(rendered(typeScale.label));
  expect(threadAge).toMatchObject(rendered(typeScale.caption));
  expect(pick(pullRequestTitle, TYPOGRAPHY_KEYS)).toEqual(pick(threadTitle, TYPOGRAPHY_KEYS));
  expect(pick(pullRequestSubtitle, TYPOGRAPHY_KEYS)).toEqual(pick(threadSubtitle, TYPOGRAPHY_KEYS));
  expect(pick(pullRequestAge, TYPOGRAPHY_KEYS)).toEqual(pick(threadAge, TYPOGRAPHY_KEYS));
  expect(row.attention.state).toBe("new");
  expect(pullRequestMarker).toEqual(threadMarker);
});

it("gives equivalent thread and pull-request rows the same card geometry", () => {
  const thread = renderThreadRow();
  const threadFrame = viewStyle(thread.getByTestId("thread-row-frame"));
  thread.unmount();

  const { row, view } = renderPullRequestRow();
  const pullRequestFrame = viewStyle(view.getByTestId(`pull-request-row-${row.number}`));

  expect(pick(pullRequestFrame, FRAME_KEYS)).toEqual(pick(threadFrame, FRAME_KEYS));
  const cellHeight = Number(threadFrame.height) + Number(threadFrame.marginVertical) * 2;
  expect(
    threadListRowHeight({
      kind: "thread",
      thread: {
        id: "thread",
        pinned: false,
        preview: "",
        serverId: "server",
        title: "",
        unread: 0,
      },
    }),
  ).toBe(cellHeight);
});
