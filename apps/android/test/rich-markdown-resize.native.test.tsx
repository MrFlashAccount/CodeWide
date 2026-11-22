import { act, fireEvent, render } from "@testing-library/react-native";
import { observablePrimitive } from "@legendapp/state";
import { Platform, View, StyleSheet, Text } from "react-native";
import { MarkdownDocumentView } from "../src/rendering/MarkdownDocumentView";
import { productFonts } from "../src/ui/product-fonts";
import { colors, spacing } from "../src/theme";
import { NativeMarkup } from "../src/rendering/NativeMarkup";
import { markdownDocumentBlocks } from "../src/rendering/markdown-document-blocks";
import { SearchHighlightQuery } from "../src/rendering/SearchMessageFocus";
import { RichMarkdown, RichMarkdownDocumentBlockView } from "../src/rendering/RichMarkdown";
import { ChatTableWidthContext } from "../src/rendering/chatTableWidth";
import { RichContentWidthProvider } from "../src/rendering/RichContentLayout";
import {
  RichMarkdownPremeasurementBoundary,
  RichMarkdownPremeasurementProvider,
} from "../src/rendering/RichMarkdownPremeasurementProvider";
import * as markdownGeometry from "../src/rendering/richMarkdownGeometry";

// Drive the real table routing and sizing, replacing only the Android view manager.
jest.mock("../src/rendering/nativeMarkdownTableHost", () => ({
  MarkdownTableHost: require("react-native").View,
}));

let consoleErrors: jest.SpyInstance;
beforeEach(() => {
  consoleErrors = jest.spyOn(console, "error");
});
afterEach(() => {
  try {
    expect(consoleErrors).not.toHaveBeenCalled();
  } finally {
    consoleErrors.mockRestore();
  }
});

const source = "| Name | Value |\n| --- | --- |\n| Alpha | One |";
const widths = [360, 720, 4, 360, 560, 280, 360];

it("keeps native paragraph wrapping unless premeasurement is enabled inside its boundary", () => {
  const paragraph = "A paragraph that wraps naturally without precomputed lines";
  const layout = jest.spyOn(markdownGeometry, "layoutRichMarkdownInline").mockImplementation(() => {
    throw new Error("Ordinary Markdown must use native text layout");
  });
  try {
    const view = render(
      <View>
        <RichMarkdown source={paragraph} />
      </View>,
    );
    const expectNativeParagraph = () => {
      const text = view.getByText(paragraph);
      expect(text.props.selectable).toBe(true);
      expect(text.props.numberOfLines).toBeUndefined();
      expect(StyleSheet.flatten(text.props.style)?.height).toBeUndefined();
      expect(layout).not.toHaveBeenCalled();
    };
    expectNativeParagraph();
    view.rerender(
      <View>
        <RichMarkdownPremeasurementProvider enabled={false} fontScale={1} width={280}>
          <RichMarkdownPremeasurementBoundary>
            <RichMarkdown source={paragraph} />
          </RichMarkdownPremeasurementBoundary>
        </RichMarkdownPremeasurementProvider>
      </View>,
    );
    expectNativeParagraph();
    view.rerender(
      <View>
        <RichMarkdownPremeasurementProvider enabled fontScale={1} width={280}>
          <RichMarkdown source={paragraph} />
        </RichMarkdownPremeasurementProvider>
      </View>,
    );
    expectNativeParagraph();
  } finally {
    layout.mockRestore();
  }
});

it("uses the Pretext line-breaking policy only inside a premeasured Android timeline", () => {
  const platform = jest.replaceProperty(Platform, "OS", "android");
  try {
    const view = render(
      <RichMarkdownPremeasurementProvider enabled={false} fontScale={1} width={280}>
        <RichMarkdownPremeasurementBoundary>
          <RichMarkdown source="A paragraph that wraps naturally" />
        </RichMarkdownPremeasurementBoundary>
      </RichMarkdownPremeasurementProvider>,
    );
    expect(
      view.getByText("A paragraph that wraps naturally").props.textBreakStrategy,
    ).toBeUndefined();

    view.rerender(
      <RichMarkdownPremeasurementProvider enabled fontScale={1} width={280}>
        <RichMarkdownPremeasurementBoundary>
          <RichMarkdown source="A paragraph that wraps naturally" />
        </RichMarkdownPremeasurementBoundary>
      </RichMarkdownPremeasurementProvider>,
    );
    expect(view.getByText("A paragraph that wraps naturally").props.textBreakStrategy).toBe(
      "simple",
    );
  } finally {
    platform.restore();
  }
});

it.each([false, true])(
  "resizes a mounted Markdown table without pinning its viewport (streaming=%s)",
  (streaming) => {
    const view = render(<RichMarkdown source={source} streaming={streaming} />);
    const viewport = view
      .UNSAFE_getAllByType(View)
      .find(
        (node) =>
          node.props.onLayout && StyleSheet.flatten(node.props.style)?.alignSelf === "stretch",
      );
    if (viewport === undefined) throw new Error("Table viewport missing");
    const cell = view.getByText("Alpha");
    for (const width of widths) {
      fireEvent(viewport, "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width, height: 100 } },
      });
      // Parent layout must remain authoritative, even after a transient 4 dp allocation.
      expect(StyleSheet.flatten(viewport.props.style).width).toBe("100%");
      expect(view.getByText("Alpha")).toBe(cell);
      const cells = view
        .UNSAFE_getAllByType(Text)
        .filter((node) => StyleSheet.flatten(node.props.style)?.minWidth === 144);
      expect(cells).toHaveLength(4);
      for (const node of cells)
        expect(StyleSheet.flatten(node.props.style).width).toBe(Math.max(144, width / 2));
    }
  },
);

it.each([source, `> ${source.replaceAll("\n", "\n> ")}`, `- ${source.replaceAll("\n", "\n  ")}`])(
  "follows supplied pane widths for a document or inset table without remounting: %s",
  (markdown) => {
    const view = render(
      <RichContentWidthProvider width={360}>
        <RichMarkdown source={markdown} />
      </RichContentWidthProvider>,
    );
    const cell = view.getByText("Alpha");
    for (const width of [720, 360, 540, 280, 360]) {
      view.rerender(
        <RichContentWidthProvider width={width}>
          <RichMarkdown source={markdown} />
        </RichContentWidthProvider>,
      );
      const viewport = view
        .UNSAFE_getAllByType(View)
        .find(
          (node) =>
            node.props.onLayout && StyleSheet.flatten(node.props.style)?.alignSelf === "stretch",
        );
      if (viewport === undefined) throw new Error("Table viewport missing");
      const inset = markdown.startsWith(">")
        ? markdownGeometry.richMarkdownGeometry.blockquoteInset
        : markdown.startsWith("-")
          ? markdownGeometry.richMarkdownGeometry.listInset
          : 0;
      expect(StyleSheet.flatten(viewport.props.style).width).toBe(width - inset);
      expect(view.getByText("Alpha")).toBe(cell);
    }
  },
);

it("preserves table cells across a streaming append and resize with repeated row content", () => {
  const initial = `${source}\n| Repeat | Same |`;
  const view = render(
    <RichContentWidthProvider width={360}>
      <RichMarkdown source={initial} streaming />
    </RichContentWidthProvider>,
  );
  const first = view.getByText("Alpha");
  view.rerender(
    <RichContentWidthProvider width={720}>
      <RichMarkdown source={`${initial}\n| Repeat | Same |`} streaming />
    </RichContentWidthProvider>,
  );
  expect(view.getByText("Alpha")).toBe(first);
  expect(view.getAllByText("Repeat")).toHaveLength(2);
  view.rerender(
    <RichContentWidthProvider width={360}>
      <RichMarkdown source={`${initial}\n| Repeat | Same |`} />
    </RichContentWidthProvider>,
  );
  expect(view.getAllByText("Repeat")).toHaveLength(2);
  expect(view.getAllByText("Same")).toHaveLength(2);
});

const code = (source: string) => <Text>{source}</Text>;
const image = (source: string) => <Text>{source}</Text>;
const link = (href: string, children: React.ReactNode) => <Text>{children}</Text>;

it.each([false, true])(
  "resizes mounted HTML table columns and reflows measured rows (provider=%s)",
  (provided) => {
    const html =
      "<table><tr><th>Head</th><th>Other</th></tr><tr><td>Left</td><td>Right</td></tr></table>";
    const content = <NativeMarkup html={html} code={code} image={image} link={link} />;
    const renderContent = (width: number) =>
      provided ? (
        <RichContentWidthProvider width={width}>{content}</RichContentWidthProvider>
      ) : (
        content
      );
    const result = render(renderContent(360));
    const cell = result.getByTestId("markup-table-cell-1-0");
    for (const width of [360, 720, 4, 360, 540, 280, 360]) {
      result.rerender(renderContent(width));
      const viewport = result.getByTestId("markup-table-viewport");
      fireEvent(viewport, "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width, height: 100 } },
      });
      expect(viewport).toHaveStyle({ width: provided ? width : "100%" });
      expect(result.getByTestId("markup-table-cell-1-0")).toBe(cell);
      expect(StyleSheet.flatten(cell.parent?.parent?.props.style)).toMatchObject({
        width: Math.max(120, width / 2),
      });
      const height = width < 400 ? 96 : 48;
      fireEvent(cell, "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: Math.max(120, width / 2), height } },
      });
      expect(StyleSheet.flatten(cell.parent?.parent?.props.style)).toMatchObject({ height });
    }
  },
);

it("propagates document viewport and reader width limits into an already mounted table", () => {
  const content = (maxWidth?: number) => (
    <MarkdownDocumentView
      footer={null}
      maxWidth={maxWidth}
      onScroll={() => undefined}
      segments={[source]}
      target={null}
      textScale={1}
    />
  );
  const view = render(content());
  const root = view.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
  if (root === undefined) throw new Error("Document viewport missing");
  for (const [width, maxWidth] of [
    [360, undefined],
    [720, undefined],
    [720, 500],
    [280, 500],
    [360, undefined],
  ] as const) {
    view.rerender(content(maxWidth));
    fireEvent(root, "layout", { nativeEvent: { layout: { x: 0, y: 0, width, height: 800 } } });
    const table = view
      .UNSAFE_getAllByType(View)
      .find(
        (node) =>
          node.props.onLayout && StyleSheet.flatten(node.props.style)?.alignSelf === "stretch",
      );
    if (table === undefined) throw new Error("Table viewport missing");
    expect(StyleSheet.flatten(table.props.style).width).toBe(
      Math.min(width, maxWidth ?? width) - spacing.md * 2,
    );
    expect(view.getAllByText("Alpha")).toHaveLength(1);
  }
});

it("switches a completed plain chat table between Android layout and highlighted search results", () => {
  const [block] = markdownDocumentBlocks([source]);
  if (!block) throw new Error("Missing fixture table");
  const table = (query: string, completedChat: boolean) => (
    <SearchHighlightQuery.Provider value={query}>
      <RichMarkdownDocumentBlockView block={block} completedChat={completedChat} />
    </SearchHighlightQuery.Provider>
  );
  const view = render(table("", false));
  expect(view.getByText("Alpha")).toBeTruthy();
  view.rerender(table("", true));
  const native = view.UNSAFE_getAllByType(View).find((node) => node.props.onTableHeight);
  if (!native) throw new Error("Completed table did not reach the Android view");
  expect(native.props.grid.cells).toEqual(["Name", "Value", "Alpha", "One"]);
  fireEvent(native, "tableHeight", { nativeEvent: { height: 123 } });
  expect(StyleSheet.flatten(native.props.style).height).toBe(123);
  view.rerender(table("alpha", true));
  expect(view.getByText("Alpha")).toHaveStyle({ backgroundColor: colors.warningContainer });
  view.rerender(table("", true));
  expect(view.queryByText("Alpha")).toBeNull();
});

it("keeps inline formatting in completed chat tables", () => {
  const [block] = markdownDocumentBlocks([source.replace("Alpha", "**Alpha**")]);
  if (!block) throw new Error("Missing formatted table");
  const view = render(<RichMarkdownDocumentBlockView block={block} completedChat />);
  expect(view.getByText("Alpha")).toBeTruthy();
  expect(view.getByText("Alpha")).toHaveStyle({ fontFamily: productFonts.semibold });
});

it.each(["block", "document"] as const)("lays out recycled %s chat tables at the pane width on their first frame", (kind) => {
  const markdown = source.replace("Alpha", "**Alpha**");
  const [block] = markdownDocumentBlocks([markdown]);
  if (!block) throw new Error("Missing formatted table");
  const width$ = observablePrimitive<number | null>(559.6);
  const table = (generation: number) => (
    <ChatTableWidthContext.Provider value={width$}>
      <View>
        {kind === "block" ? (
          <RichMarkdownDocumentBlockView key={generation} block={block} completedChat />
        ) : (
          <RichMarkdown key={generation} source={markdown} />
        )}
      </View>
    </ChatTableWidthContext.Provider>
  );
  const view = render(table(0));
  for (const [width, generation] of [[559.6, 0], [559.6, 1], [360, 1], [360, 2]] as const) {
    act(() => {
      width$.set(width);
    });
    view.rerender(table(generation));
    expect(view.getByText("Value")).toHaveStyle({ width: Math.ceil(width) / 2 });
  }
  const viewport = view.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
  if (!viewport) throw new Error("Table viewport missing");
  fireEvent(viewport, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 344, height: 80 } } });
  expect(view.getByText("Value")).toHaveStyle({ width: 172 });
});

it("honors the existing line layout inside a premeasured chat boundary", () => {
  const [block] = markdownDocumentBlocks([source]);
  if (!block) throw new Error("Missing fixture table");
  const view = render(
    <RichMarkdownPremeasurementProvider enabled fontScale={1} width={280}>
      <RichMarkdownPremeasurementBoundary>
        <RichMarkdownDocumentBlockView completedChat block={block} />
      </RichMarkdownPremeasurementBoundary>
    </RichMarkdownPremeasurementProvider>,
  );
  expect(view.getByText("Alpha")).toBeTruthy();
});
